import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  HeartHandshake,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import type { PortalCommand, PortalState } from './domain/model';
import { api, isDemo, mailEnabled, readPortal, resetDemo, runCommand, supabase } from './client';
import Parents from './features/Parents';
import Admin from './features/Admin';
import { BusyButton, Modal, Notice } from './ui';

type Page = 'foraldrar' | 'oversikt' | 'evenemang' | 'familjer' | 'fordelning' | 'paminnelser';
const route = (): Page => {
  const value = location.hash.replace(/^#\//, '');
  return ['foraldrar', 'oversikt', 'evenemang', 'familjer', 'fordelning', 'paminnelser'].includes(
    value,
  )
    ? (value as Page)
    : 'foraldrar';
};
const adminPages = [
  { id: 'oversikt', name: 'Översikt', icon: LayoutDashboard },
  { id: 'evenemang', name: 'Evenemang', icon: CalendarDays },
  { id: 'familjer', name: 'Barn & föräldrar', icon: Users },
  { id: 'fordelning', name: 'Rättvis fördelning', icon: ChartNoAxesCombined },
  { id: 'paminnelser', name: mailEnabled ? 'Mejl & drift' : 'Kontakt & drift', icon: Mail },
] as const;
export default function App() {
  const [state, setState] = useState<PortalState | null>(null);
  const stateRef = useRef<PortalState | null>(null);
  const readSequence = useRef(0);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [login, setLogin] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [menu, setMenu] = useState(false);
  const [page, setPage] = useState<Page>(route);
  const [familyId, setFamilyId] = useState(() => localStorage.getItem('passlaget-family') || '');
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [subscriptionAction, setSubscriptionAction] = useState<{
    action: 'verify_subscription' | 'unsubscribe';
    token: string;
  } | null>(null);
  const tell = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const setCurrent = useCallback((value: PortalState) => {
    stateRef.current = value;
    setState(value);
  }, []);
  const refresh = useCallback(
    async (asAdmin = admin) => {
      const sequence = ++readSequence.current;
      try {
        setFatal('');
        const value = await readPortal(asAdmin);
        if (sequence === readSequence.current) setCurrent(value);
      } catch (e) {
        if (sequence === readSequence.current) setFatal((e as Error).message);
      } finally {
        if (sequence === readSequence.current) setLoading(false);
      }
    },
    [admin, setCurrent],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const change = () => {
      setPage(route());
      setMenu(false);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 12000 : 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>('.sidebar-close')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (previous?.isConnected) previous.focus();
    };
  }, [menu]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('subscription'))
      setSubscriptionAction({ action: 'verify_subscription', token: params.get('subscription')! });
    else if (params.get('unsubscribe'))
      setSubscriptionAction({ action: 'unsubscribe', token: params.get('unsubscribe')! });
  }, []);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery(true);
        setAdmin(true);
      } else if (event === 'SIGNED_OUT') {
        setAdmin(false);
        setPage('foraldrar');
      } else if (session && event === 'INITIAL_SESSION') {
        setAdmin(true);
        setPage(route());
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  function navigate(next: Page) {
    setPage(next);
    setMenu(false);
    location.hash = `/${next}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function mutate(command: PortalCommand, expectedVersion?: number) {
    if (!stateRef.current) throw new Error('Vänta tills uppgifterna har hämtats.');
    if (expectedVersion !== undefined && stateRef.current.version !== expectedVersion)
      throw new Error(
        'Uppgifterna har ändrats sedan redigeringen öppnades. Öppna den igen för att få senaste versionen.',
      );
    ++readSequence.current;
    let next = await runCommand(command, stateRef.current.version, admin);
    if (
      admin &&
      !isDemo &&
      ['confirm', 'book', 'update_answers', 'request_change'].includes(command.type)
    )
      next = await readPortal(true);
    setCurrent(next);
    return next;
  }
  async function startAdmin() {
    if (isDemo) {
      setAdmin(true);
      navigate('oversikt');
      return;
    }
    if ((await supabase!.auth.getSession()).data.session) {
      setAdmin(true);
      navigate('oversikt');
    } else setLogin(true);
  }
  async function leaveAdmin() {
    if (supabase) await supabase.auth.signOut();
    setAdmin(false);
    navigate('foraldrar');
  }
  const pickFamily = (id: string) => {
    setFamilyId(id);
    localStorage.setItem('passlaget-family', id);
  };
  const parentView = page === 'foraldrar' || !admin;
  return (
    <div className={`app-shell ${parentView ? 'parent-layout' : 'admin-layout'}`}>
      {!parentView && (
        <aside id="admin-navigation" className={`sidebar ${menu ? 'open' : ''}`}>
          <a
            href="#/foraldrar"
            className="brand club-brand"
            onClick={(e) => {
              e.preventDefault();
              navigate('foraldrar');
            }}
          >
            <img
              className="club-crest"
              src={`${import.meta.env.BASE_URL}landvetter-is.png`}
              alt=""
              width={48}
              height={46}
            />
            <span>Landvetter IS P2018</span>
          </a>
          <button
            className="icon-button sidebar-close"
            aria-label="Stäng meny"
            onClick={() => setMenu(false)}
          >
            <X />
          </button>
          <div className="sidebar-team">
            <Users size={22} aria-hidden="true" />
            <div>
              <strong>{state?.team.clubName || 'Landvetter IS'}</strong>
              <span>{state?.team.name || 'P2018'}</span>
            </div>
          </div>
          <p className="nav-caption">ADMINISTRATION</p>
          <nav>
            <button className="nav-item" onClick={() => navigate('foraldrar')}>
              <HeartHandshake size={20} />
              Föräldrasida
            </button>
            {admin &&
              adminPages.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${page === item.id ? 'active' : ''}`}
                  aria-current={page === item.id ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <item.icon size={20} />
                  {item.name}
                  {page === item.id && <ChevronRight size={16} />}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <p>
              Tillsammans
              <br />
              <strong>runt planen.</strong>
            </p>
            <button className="sidebar-login" onClick={leaveAdmin}>
              <LogOut size={17} />
              Lämna administrationen
            </button>
            <span className="sidebar-foot">Passlaget · föreningsliv tillsammans</span>
          </div>
        </aside>
      )}
      {!parentView && menu && <div className="sidebar-overlay" onClick={() => setMenu(false)} />}
      <div className="main-shell">
        {parentView ? (
          <header className="public-masthead">
            <a
              href="#/foraldrar"
              className="brand club-brand"
              onClick={(e) => {
                e.preventDefault();
                navigate('foraldrar');
              }}
            >
              <img
                className="club-crest"
                src={`${import.meta.env.BASE_URL}landvetter-is.png`}
                alt=""
                width={48}
                height={46}
              />
              <span>Landvetter IS P2018</span>
            </a>
          </header>
        ) : (
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(true)}
              aria-label="Öppna meny"
              aria-expanded={menu}
              aria-controls="admin-navigation"
            >
              <Menu />
            </button>
            <div className="breadcrumbs">
              <span className="breadcrumb-club">{state?.team.clubName || 'Landvetter IS'}</span>
              <ChevronRight className="breadcrumb-separator" size={13} />
              <span>{adminPages.find((p) => p.id === page)?.name}</span>
            </div>
            <div className="topbar-actions">
              {isDemo && <span className="demo-pill">Demo</span>}
              {admin && (
                <span className="admin-pill">
                  <ShieldCheck size={15} />
                  Administratör
                </span>
              )}
              <button
                className="icon-button refresh-button"
                title="Hämta senaste uppgifterna"
                aria-label="Hämta senaste uppgifterna"
                onClick={() => refresh()}
              >
                <RefreshCw size={17} />
              </button>
              {!admin && (
                <button className="button ghost compact" onClick={startAdmin}>
                  Administration
                  <ArrowUpRight size={16} />
                </button>
              )}
            </div>
          </header>
        )}
        {isDemo && (
          <div className="demo-banner">
            <span>
              <strong>Demonstration</strong> · Påhittade familjer. Ändringar sparas bara i den här
              webbläsaren.
            </span>
            {admin && (
              <button
                onClick={() => {
                  if (window.confirm('Återställ alla ändringar i demonstrationen?')) {
                    resetDemo();
                    void refresh();
                    tell('Demonstrationen har återställts.');
                  }
                }}
              >
                Återställ demo
              </button>
            )}
          </div>
        )}
        <main>
          {fatal && (
            <div className="connection-error">
              <Notice text={fatal} error />
              <p>
                Inga ändringar har bekräftats. Kontrollera anslutningen och försök hämta uppgifterna
                igen.
              </p>
              <button className="button secondary" onClick={() => refresh()}>
                <RefreshCw size={16} />
                Försök igen
              </button>
              {admin && (
                <button className="button ghost" onClick={leaveAdmin}>
                  Till föräldrasidan
                </button>
              )}
            </div>
          )}
          {loading && !state ? (
            <div className="loading-page">
              <LoaderCircle className="spin" size={32} />
              <p>Hämtar lagets bemanning…</p>
            </div>
          ) : state && !fatal ? (
            page === 'foraldrar' || !admin ? (
              <Parents
                state={state}
                familyId={familyId}
                setFamilyId={pickFamily}
                mutate={mutate}
                tell={tell}
              />
            ) : (
              <Admin state={state} page={page} navigate={navigate} mutate={mutate} tell={tell} />
            )
          ) : null}
        </main>
        <footer className="page-footer">
          {parentView ? (
            <div className="public-footer-actions">
              <button className="text-button" onClick={() => refresh()}>
                <RefreshCw size={15} /> Uppdatera schemat
              </button>
              <button className="text-button" onClick={startAdmin}>
                Administration <ArrowUpRight size={15} />
              </button>
            </div>
          ) : (
            <span>Passlaget</span>
          )}
        </footer>
      </div>
      {toast && (
        <div className="toast">
          <Notice text={toast.text} error={toast.error} />
          <button aria-label="Stäng meddelande" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {login && (
        <LoginModal
          onClose={() => setLogin(false)}
          onDone={() => {
            setLogin(false);
            setAdmin(true);
            navigate('oversikt');
          }}
        />
      )}
      {recovery && <RecoveryModal onClose={() => setRecovery(false)} tell={tell} />}
      {subscriptionAction && (
        <SubscriptionModal
          value={subscriptionAction}
          onClose={() => {
            setSubscriptionAction(null);
            history.replaceState(null, '', location.pathname + location.hash);
          }}
          tell={tell}
        />
      )}
    </div>
  );
}
function LoginModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <Modal title={reset ? 'Återställ lösenord' : 'Logga in som lagförälder'} onClose={onClose}>
      <form
        className="modal-body form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage('');
          try {
            if (reset) {
              if (!mailEnabled) throw new Error('Återställning via mejl är inte aktiverad.');
              await api({
                action: 'request_recovery',
                email,
                returnUrl: location.origin + location.pathname,
              });
              setMessage(
                'Om adressen tillhör en administratör skickas ett återställningsmejl. Det kan ta några minuter.',
              );
            } else {
              const { error } = await supabase!.auth.signInWithPassword({ email, password });
              if (error)
                throw new Error('Det gick inte att logga in. Kontrollera mejladress och lösenord.');
              onDone();
            }
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {reset
            ? 'Ange administratörens mejladress.'
            : 'Planera evenemang, hantera familjer och följ upp bemanningen.'}
        </p>
        <label>
          Mejladress
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {!reset && (
          <label>
            Lösenord
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {message && (
          <p className="inline-message" role="status">
            {message}
          </p>
        )}
        <BusyButton className="button primary full" type="submit" busy={busy}>
          {reset ? 'Skicka återställningsmejl' : 'Logga in'}
        </BusyButton>
        {mailEnabled ? (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setReset(!reset);
              setMessage('');
            }}
          >
            {reset ? (
              <>
                <ArrowLeft size={15} />
                Till inloggning
              </>
            ) : (
              'Glömt lösenord?'
            )}
          </button>
        ) : (
          <p className="hint">
            Återställning via mejl är inte aktiverad. Kontakta den som förvaltar portalen om du
            behöver ett nytt lösenord.
          </p>
        )}
      </form>
    </Modal>
  );
}
function RecoveryModal({
  onClose,
  tell,
}: {
  onClose: () => void;
  tell: (text: string, error?: boolean) => void;
}) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Välj nytt administratörslösenord" onClose={onClose}>
      <form
        className="modal-body form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== repeat) {
            setError('Lösenorden matchar inte.');
            return;
          }
          setBusy(true);
          const { error } = await supabase!.auth.updateUser({ password });
          setBusy(false);
          if (error) setError(error.message);
          else {
            tell('Lösenordet har uppdaterats.');
            onClose();
          }
        }}
      >
        <label>
          Nytt lösenord
          <input
            minLength={12}
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Upprepa lösenordet
          <input
            minLength={12}
            type="password"
            required
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        {error && <Notice text={error} error />}
        <BusyButton type="submit" className="button primary" busy={busy}>
          Spara lösenord
        </BusyButton>
      </form>
    </Modal>
  );
}
function SubscriptionModal({
  value,
  onClose,
  tell,
}: {
  value: { action: 'verify_subscription' | 'unsubscribe'; token: string };
  onClose: () => void;
  tell: (text: string, error?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={
        value.action === 'unsubscribe' ? 'Avsluta mejlpåminnelser' : 'Bekräfta mejlpåminnelser'
      }
      onClose={onClose}
    >
      <div className="modal-body form-stack">
        <p>
          {value.action === 'unsubscribe'
            ? 'Vill du avsluta mejlpåminnelserna som den här länken gäller?'
            : 'Bekräfta att du vill ta emot mejl om lagets bemanning.'}
        </p>
        {error && <Notice text={error} error />}
        <BusyButton
          className="button primary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(value);
              tell(
                value.action === 'unsubscribe'
                  ? 'Mejlpåminnelserna är avslutade.'
                  : 'Mejlpåminnelserna är aktiverade.',
              );
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check size={17} />
          {value.action === 'unsubscribe' ? 'Avsluta påminnelser' : 'Aktivera påminnelser'}
        </BusyButton>
      </div>
    </Modal>
  );
}
