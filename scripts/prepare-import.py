#!/usr/bin/env python3
"""Read a Google Sheets staffing PDF into a PRIVATE, unverified import candidate.

No source-specific personal information is embedded here. Layout columns are
detected from Swedish table headings; uncertain rows are preserved for review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pypdf import PdfReader


def normal(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).strip()).casefold()


def clean_child(value):
    return re.sub(r"\s*\(slutat\)\s*", "", value, flags=re.I).strip()


def uid(kind, value):
    return f"imp_{kind}_" + hashlib.sha256(normal(value).encode()).hexdigest()[:20]


def phone(value):
    found = re.search(r"(?:\+46|0)[\d\s-]{7,18}\d", value)
    return re.sub(r"[\s-]", "", found.group(0)) if found else ""


def short_names(value):
    """Expand an explicit 'First/Other Surname' or 'First & Other Surname'."""
    if not re.search(r"[/&]", value):
        return [clean_child(value)]
    parts = re.split(r"\s*[/&]\s*", clean_child(value))
    if len(parts) != 2 or len(parts[1].split()) < 2:
        return [clean_child(value)]
    surname = " ".join(parts[1].split()[1:])
    return [parts[0] + " " + surname if len(parts[0].split()) == 1 else parts[0], parts[1]]


TIME = re.compile(r"^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}|Stängning)", re.I)
DATE = re.compile(r"(?:Måndag|Tisdag|Onsdag|Torsdag|Fredag|Lördag|Söndag),?\s+(\d{1,2})/(\d{1,2})(?:\s*-(\d{2,4}))?", re.I)
ROLE_NAMES = {"Café-tid": "Kiosk/café", "Cafebemanning": "Kiosk/café", "Cafe": "Kiosk/café", "Café": "Kiosk/café"}


def local_time(day, month, year, value):
    if year is None or not re.fullmatch(r"\d{1,2}:\d{2}", value):
        return ""
    hour, minute = map(int, value.split(":"))
    return datetime(year, month, day, hour, minute, tzinfo=ZoneInfo("Europe/Stockholm")).isoformat()


def parse_pdf(path):
    reader = PdfReader(str(path))
    pages = [page.extract_text(extraction_mode="layout") or "" for page in reader.pages]
    roster, dated, undated, evidence, ignored = [], [], [], [], []
    for page_no, text in enumerate(pages, 1):
        lines = text.splitlines()
        header = next((line for line in lines if "Ledare / Lagförälder" in line and "Tillfällen" in line), None)
        if header:
            cols = [header.index(label) for label in ["Spelare", "Förälder", "Ledare / Lagförälder", "Telefon", "Skapad", "Tillfällen"]]
            # Rankings to the right are control totals, never source assignments.
            end = header.find("Top 15", cols[-1])
            for line_no, line in enumerate(lines, 1):
                if line == header or not line.strip():
                    continue
                row = [line[cols[i]:cols[i + 1]].strip() for i in range(len(cols) - 1)]
                row.append(line[cols[-1]:end if end > 0 else None].strip())
                if not row[0] or not re.fullmatch(r"\d+", row[-1]):
                    continue
                roster.append(dict(child=row[0], adult=row[1], exempt=bool(row[2]), phone=phone(row[3]), createdRaw=row[4], total=int(row[5]), ref=f"sida {page_no}, rad {line_no}"))
            continue
        hist_header = next((line for line in lines if "Tillfälle och tid" in line and "Uppgift" in line), None)
        if hist_header:
            cols = [hist_header.index(label) for label in ["Spelares namn", "Förälders namn", "Telefon", "Uppgift", "Kommentar"]]
            current_date = None
            for line_no, line in enumerate(lines, 1):
                found_date = DATE.search(line[:cols[1]])
                if found_date:
                    current_date = found_date
                    continue
                tm = TIME.match(line.strip())
                if not tm:
                    continue
                child, adult, tel, role = [line[cols[i]:cols[i + 1]].strip() for i in range(4)]
                if not child or not role or not current_date:
                    ignored.append(dict(ref=f"sida {page_no}, rad {line_no}", reason="Ofullständig historikrad", raw=line.rstrip()))
                    continue
                day, month = map(int, current_date.group(1, 2))
                year = int(current_date.group(3)) if current_date.group(3) else None
                if year and year < 100:
                    year += 2000
                row = dict(child=child, adult=adult, phone=phone(tel), role=ROLE_NAMES.get(role, role), day=day, month=month, year=year, startRaw=tm.group(1), endRaw=tm.group(2), dateRaw=current_date.group(0), ref=f"sida {page_no}, rad {line_no}")
                row.update(startsAt=local_time(day, month, year, tm.group(1)), endsAt=local_time(day, month, year, tm.group(2)))
                (dated if row["startsAt"] and row["endsAt"] else undated).append(row)
            continue
        # Earlier individual schedules are useful contact evidence, with missing years.
        current_date, role, cols = None, "", None
        schedule_title = next((line.strip() for line in lines if "Cafebemanning" in line), "")
        for line_no, line in enumerate(lines, 1):
            if "Spelarens namn" in line and "Ansvarig namn + telefon" in line:
                cols = [line.index("Spelarens namn"), line.index("Ansvarig namn + telefon"), line.index("Kommentar")]
                role = "Kiosk/café"
            elif "Spelares namn" in line and "Telefon" in line:
                cols = [line.index("Spelares namn"), line.index("Telefon"), line.find("Ansvarigt lag")]
                if cols[2] < 0:
                    cols[2] = cols[1] + 64
                role = ROLE_NAMES.get(line[:cols[0]].strip(), line[:cols[0]].strip())
            dm = DATE.search(line[:cols[1] if cols else 100])
            if dm:
                current_date = dm
            tm = TIME.match(line.strip())
            if not tm or not cols or not current_date:
                continue
            child = line[cols[0]:cols[1]].strip()
            raw_contact = line[cols[1]:cols[2]].strip()
            ref = f"sida {page_no}, rad {line_no}"
            if not child:
                ignored.append(dict(ref=ref, reason="Tom extrarad, inget antaget bemanningsbehov", raw=line[:cols[2]].rstrip()))
                continue
            if re.fullmatch(r"[FP]\d{4}|Vakant|\d+ ledare", child, flags=re.I):
                ignored.append(dict(ref=ref, reason="Annat lags ansvar, vakant eller samlingsrad", raw=line[:cols[2]].rstrip()))
                continue
            # Capture known contact name only, never infer a name from a telephone.
            bracket = re.search(r"\(([^)]*)\)", raw_contact)
            adult = bracket.group(1) if bracket else (raw_contact.split(",", 1)[0].strip() if "," in raw_contact else "")
            adult = adult if not re.search(r"\d|TBD", adult) else ""
            row = dict(child=child, adult=adult, phone=phone(raw_contact), role=role, day=int(current_date.group(1)), month=int(current_date.group(2)), year=None, startRaw=tm.group(1), endRaw=tm.group(2), startsAt="", endsAt="", dateRaw=current_date.group(0), scheduleTitle=schedule_title, ref=ref, comment=line[cols[2]:].strip() if schedule_title else "", contactRaw=raw_contact)
            undated.append(row)
            evidence.append(row)
    return pages, roster, dated, undated, evidence, ignored


def build(path):
    pages, roster, dated, undated, contacts, ignored = parse_pdf(path)
    families, children, adults, history = {}, {}, {}, {}
    issues, refs, totals = [], defaultdict(list), {}
    child_keys = {}
    # Only explicit slash/ampersand sibling evidence groups existing registry rows.
    sibling_sets = [short_names(row["child"]) for row in undated + dated if len(short_names(row["child"])) > 1]
    canonical_groups = {}
    for names in sibling_sets:
        group = " / ".join(sorted(names, key=normal))
        for name in names:
            canonical_groups[normal(name)] = group

    def add_child(raw, active, exempt=False, ref="", roster_entry=False):
        names = short_names(raw)
        ids = []
        for name in names:
            key = normal(name)
            group = canonical_groups.get(key, name)
            fid = uid("family", group)
            cid = uid("child", name)
            if fid not in families:
                families[fid] = dict(id=fid, label=group, active=active, exempt=exempt)
            else:
                families[fid]["active"] |= active
                families[fid]["exempt"] |= exempt
            if cid not in children:
                children[cid] = dict(id=cid, name=name, familyId=fid, active=active)
            elif roster_entry:
                children[cid]["active"] = active
            child_keys[key] = cid
            if ref:
                refs[cid].append(ref)
            ids.append(fid)
        return ids[0]

    def resolve_child(raw, ref, allow_new=True):
        key = normal(clean_child(raw))
        names = short_names(raw)
        known = [child_keys.get(normal(name)) for name in names]
        if all(known):
            if "(slutat)" in raw.casefold() and any(children[cid]["active"] for cid in known):
                issues.append(dict(type="membership_conflict", ref=ref, child=raw, message="Aktivt i registret men slutat-markerat i schema. Registerstatus behålls tills uppgiften granskats."))
            return children[known[0]]["familyId"]
        if not allow_new:
            return None
        fid = add_child(raw, False, ref=ref)
        issues.append(dict(type="membership_review", ref=ref, child=raw, familyId=fid, message="Saknas i aktuellt register. Inaktiv tills medlemsstatus bekräftats; slutat-markering bevaras."))
        return fid

    def add_adult(name, tel, fid, ref, preferred=False):
        if not name:
            if tel:
                issues.append(dict(type="unnamed_contact", familyId=fid, ref=ref, phone=tel, message="Telefon utan säkert namn; ingen påhittad vuxen skapas."))
            return
        # Full name + family identifies a contact; shared phone alone never merges people.
        same_family = [a for a in adults.values() if fid in a["familyIds"]]
        exact = next((a for a in same_family if normal(a["name"]) == normal(name)), None)
        abbreviations = [a for a in same_family if tel and a["phone"] == tel and normal(a["name"]).split()[0] == normal(name)]
        abbreviated = abbreviations[0] if len(abbreviations) == 1 else None
        match = exact or abbreviated
        if match:
            refs[match["id"]].append(ref)
            if tel and match["phone"] and match["phone"] != tel:
                issues.append(dict(type="phone_conflict", adultId=match["id"], name=match["name"], selectedPhone=match["phone"], alternativePhone=tel, ref=ref, message="Registertelefon behålls som kandidat. Bekräfta nuvarande nummer."))
            elif tel and not match["phone"]:
                match["phone"] = tel
            return
        # Shared exact named guardian is one person across the explicitly merged sibling family.
        aid = uid("adult", fid + "|" + name)
        adults[aid] = dict(id=aid, name=name.strip(), phone=tel, familyIds=[fid], active=families[fid]["active"])
        refs[aid].append(ref)
        if not preferred:
            issues.append(dict(type="additional_adult", adultId=aid, familyId=fid, ref=ref, message="Annan namngiven vuxen från schema. Separat person; relation och namn behöver granskas."))

    for row in roster:
        fid = add_child(row["child"], "(slutat)" not in row["child"].casefold(), row["exempt"], row["ref"], True)
        add_adult(row["adult"], row["phone"], fid, row["ref"], True)
        totals[uid("child", clean_child(row["child"]))] = dict(value=row["total"], ref=row["ref"], createdRaw=row["createdRaw"])

    for row in dated:
        fid = resolve_child(row["child"], row["ref"])
        add_adult(row["adult"], row["phone"], fid, row["ref"])
        key = "|".join([fid, row["startsAt"], row["endsAt"], row["role"]])
        hid = uid("history", key)
        refs[hid].append(row["ref"])
        if hid in history:
            issues.append(dict(type="duplicate_history", historyId=hid, ref=row["ref"], message="Samma familj, dag, tid och uppdrag räknas bara en gång."))
            continue
        history[hid] = dict(id=hid, familyId=fid, assignmentId=uid("assignment", key), eventTitle=f"Bemanning {row['startsAt'][:10]}", roleName=row["role"], startsAt=row["startsAt"], endsAt=row["endsAt"], source="import", verified=False)

    matched_undated = []
    unresolved_schedules = []
    for row in undated:
        fid = resolve_child(row["child"], row["ref"], False)
        if fid:
            add_adult(row["adult"], row["phone"], fid, row["ref"])
        candidates = [h for h in history.values() if h["familyId"] == fid and int(h["startsAt"][5:7]) == row["month"] and int(h["startsAt"][8:10]) == row["day"] and h["startsAt"][11:16] == row["startRaw"].zfill(5) and h["endsAt"][11:16] == row["endRaw"].zfill(5) and h["roleName"] == row["role"]]
        record = dict(row, familyId=fid, flags=["year_missing", "not_imported_as_history"])
        if len(candidates) == 1:
            refs[candidates[0]["id"]].append(row["ref"] + " (möjlig årtalslös kopia)")
            record["possibleDuplicateOf"] = candidates[0]["id"]
            matched_undated.append(record)
        else:
            unresolved_schedules.append(record)
        if not fid:
            # Give review suggestions, never auto-merge lookalike names or shared phone.
            tokens = set(normal(clean_child(row["child"])).split())
            suggestions = [c["name"] for c in children.values() if len(tokens & set(normal(c["name"]).split())) >= max(1, len(tokens) - 1)]
            issues.append(dict(type="unresolved_child", child=row["child"], ref=row["ref"], suggestions=suggestions, message="Namn ej säkert kopplat. Ingen automatisk sammanslagning."))

    # Surface similar child spellings/status contradictions without merging.
    items = list(children.values())
    for index, a in enumerate(items):
        for b in items[index + 1:]:
            aa, bb = normal(a["name"]).split(), normal(b["name"]).split()
            if len(aa) > 1 and len(bb) > 1 and aa[1:] == bb[1:] and a["familyId"] != b["familyId"]:
                issues.append(dict(type="similar_names", childIds=[a["id"], b["id"]], names=[a["name"], b["name"]], active=[a["active"], b["active"]], message="Liknande namn har separata familjer tills identitet och eventuell slutat-markering har granskats."))

    family_counts = Counter(h["familyId"] for h in history.values())
    # Do not add child totals together for siblings. They are comparison data only.
    comparisons = []
    for f in families.values():
        members = [c for c in children.values() if c["familyId"] == f["id"]]
        controls = [{"child": c["name"], **totals[c["id"]]} for c in members if c["id"] in totals]
        comparisons.append(dict(familyId=f["id"], family=f["label"], uniqueCandidatePasses=family_counts[f["id"]], sourceTotals=controls, verifiedPasses=0))
        if controls and any(c["value"] != family_counts[f["id"]] for c in controls):
            issues.append(dict(type="total_mismatch", familyId=f["id"], family=f["label"], uniqueCandidatePasses=family_counts[f["id"]], sourceTotals=controls, message="Registersummeringen skiljer sig från unika daterade schemarader. Avgör vilka som faktiskt genomförts; ingen automatisk saldokorrigering görs."))

    source_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    result = dict(families=list(families.values()), children=list(children.values()), adults=list(adults.values()), history=list(history.values()))
    result["_review"] = dict(schemaVersion=1, sourceFile=path.name, sourceSha256=source_sha, pageCount=len(pages), approvalRequired=True, importedHistoryVerified=False, sourceReferences=dict(refs), sourceControlTotals=totals, note="Ingen mejlprenumeration eller händelse publiceras av importen. Registerfältet Skapad är inte barnets startdatum.")
    report = dict(sourceSha256=source_sha, issues=issues, familyComparisons=comparisons, undatedPossibleDuplicates=matched_undated, undatedSchedules=unresolved_schedules, ignoredRows=ignored)
    return result, report, pages


def report_markdown(candidate, review):
    lines = ["# Privat importgranskning", "", "Detta underlag innehåller personuppgifter och får inte publiceras i kodrepositoryt.", "", "## Status", "", "- Alla historikposter har `verified: false`. Ett gammalt schema bevisar inte att passet genomfördes.", "- En kandidat kan granskas lokalt. Först godkända uppgifter förs in i lagets databas.", "- Årtalslösa schemarader bevaras separat; varken årtal eller genomförande antas.", "- Summeringar används som kontrollvärden, aldrig som nya insatser.", "- Syskonens gemensamma pass summeras en gång per familj.", "", "## Omfattning", ""]
    for key, label in [("families", "Familjer"), ("children", "Barn"), ("adults", "Namngivna vuxna"), ("history", "Unika daterade historikkandidater")]:
        lines.append(f"- {label}: {len(candidate[key])}")
    lines += [f"- Årtalslösa möjliga kopior: {len(review['undatedPossibleDuplicates'])}", f"- Övriga årtalslösa schemarader: {len(review['undatedSchedules'])}", "", "## Kontroll per familj", "", "| Familj | Unika kandidater | Registervärden per barn (summeras inte) |", "|---|---:|---|"]
    for row in review["familyComparisons"]:
        totals = "; ".join(f"{c['child']}: {c['value']}" for c in row["sourceTotals"]) or "saknas"
        lines.append(f"| {row['family']} | {row['uniqueCandidatePasses']} | {totals} |")
    lines += ["", "## Uppgifter som behöver granskas", ""]
    for issue in review["issues"]:
        lines += [f"- **{issue['type']}**: {issue['message']}  ", "  " + json.dumps({k: v for k, v in issue.items() if k not in ['type', 'message']}, ensure_ascii=False)]
    lines += ["", "## Schemarader utan bekräftat årtal", "", "Dessa rader finns inte i candidate.json:s historik. Verifiera årtal och om de är gamla eller kommande innan de förs in.", ""]
    for row in review["undatedSchedules"]:
        lines.append(f"- {row['ref']}: {row['dateRaw']} {row['startRaw']}–{row['endRaw']}, {row['role']}, {row['child']}. Ansvarig: {row['adult'] or 'ej namngiven'}, {row['phone'] or 'nummer saknas'}. Kommentar: {row.get('comment') or 'ingen'}. ")
    lines += ["", "## Möjliga kopior (räknas inte igen)", ""]
    lines += [f"- {r['ref']}: {r['child']}, {r['dateRaw']}, {r['startRaw']}–{r['endRaw']}, {r['role']} → {r['possibleDuplicateOf']}" for r in review["undatedPossibleDuplicates"]]
    lines += ["", "## Rader utan egna tilldelningar", "", "Tomma rader är inte automatiskt vakanser. Andra lags pass är inte vårt lags luckor.", ""]
    lines += [f"- {r['ref']}: {r['reason']}. {r['raw'].strip()}" for r in review["ignoredRows"]]
    lines += ["", "Fullständiga källhänvisningar finns i candidate.json under `_review.sourceReferences`; fullständig granskningsdata i review.json.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / ".local" / "import")
    args = parser.parse_args()
    out = args.output.resolve()
    if ".local" not in out.parts:
        parser.error("Persondata får endast skrivas under en .local-katalog som är gitignorerad.")
    out.mkdir(parents=True, exist_ok=True)
    candidate, review, pages = build(args.pdf)
    (out / "candidate.json").write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "review.json").write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "review.md").write_text(report_markdown(candidate, review), encoding="utf-8")
    for index, content in enumerate(pages, 1):
        (out / f"page-{index}.txt").write_text(content, encoding="utf-8")
    print(json.dumps({"pages": len(pages), "families": len(candidate["families"]), "children": len(candidate["children"]), "adults": len(candidate["adults"]), "unverifiedHistory": len(candidate["history"]), "issues": len(review["issues"]), "undatedRows": len(review["undatedSchedules"]), "output": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
