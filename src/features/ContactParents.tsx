import { useEffect, useState } from 'react';
import { ChevronRight, Mail } from 'lucide-react';
import { readAdminContacts } from '../client';
import type { AdminContact } from '../domain/model';
import { Modal, Notice } from '../ui';

export default function ContactParents({ onClose }: { onClose: () => void }) {
  const [contacts, setContacts] = useState<AdminContact[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setContacts(null);
    readAdminContacts()
      .then((next) => {
        if (active) setContacts(next);
      })
      .catch(() => {
        if (active) setError('Kontaktuppgifterna kunde inte hämtas. Försök igen.');
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <Modal title="Kontakta lagförälder" onClose={onClose}>
      <div className="modal-body md-contact-body">
        <p>Välj vem du vill kontakta så öppnas din mejlapp.</p>
        {error ? (
          <>
            <Notice error text={error} />
            <button className="button secondary" onClick={() => setAttempt((n) => n + 1)}>
              Försök igen
            </button>
          </>
        ) : contacts === null ? (
          <p role="status">Hämtar lagföräldrar…</p>
        ) : contacts.length === 0 ? (
          <p role="status">Det finns inga lagföräldrar med mejladress att visa just nu.</p>
        ) : (
          <ul className="md-contact-list" aria-label="Lagföräldrar">
            {contacts.map((contact) => (
              <li key={contact.email}>
                <a href={`mailto:${encodeURIComponent(contact.email)}`}>
                  <Mail size={21} aria-hidden="true" />
                  <span>
                    <strong>{contact.name}</strong>
                    {contact.name !== contact.email && <small>{contact.email}</small>}
                  </span>
                  <ChevronRight size={19} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
