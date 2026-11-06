# GOLD Iscrizioni

Sito per le iscrizioni dei soci GOLD (Gruppo Orientisti Lugano e Dintorni) ad allenamenti, gare e trasferte.

- **Accesso senza password:** il socio scrive la sua email e riceve un codice. Entrano solo le email presenti nell'elenco soci.
- **Iscrizioni:** ogni socio iscrive sé stesso e i familiari e può annullare fino a X ore prima dell'evento. X si imposta per ogni evento.
- **Posti limitati:** se l'evento ha un numero massimo di posti, le iscrizioni si bloccano quando è pieno.
- **Amministratori:** creano e modificano gli eventi, vedono e copiano gli iscritti, gestiscono l'elenco soci (anche incollando righe "Nome Cognome; email").

## Struttura

| File | Contenuto |
|---|---|
| `index.html` | L'intero sito: HTML, CSS e JavaScript, con supabase-js da CDN |
| `supabase/schema.sql` | Tabelle, funzioni e regole di sicurezza (RLS) del database |

Il sito è statico: non ha build e non ha server. Tutte le regole (chiusura iscrizioni, posti, permessi) sono applicate dal database con le policy RLS, quindi non si aggirano modificando la pagina. La chiave in `index.html` è la chiave *publishable* di Supabase, pensata per stare nel browser.

## Configurazione

1. **Vercel:** *Add New → Project → Import* di questo repository, senza framework e senza build. Ogni push su `main` ripubblica il sito.
2. **Supabase → Authentication → Email Templates:** nei modelli *Magic Link* e *Confirm signup* inserire il codice `{{ .Token }}`, ad esempio:
   ```html
   <h2>Codice di accesso GOLD</h2>
   <p>Il tuo codice è: <strong>{{ .Token }}</strong></p>
   <p>Se non l'hai richiesto tu, ignora questa email.</p>
   ```
3. **Supabase → Authentication → SMTP Settings:** configurare un servizio di invio email, ad esempio Brevo (gratuito fino a 300 email al giorno). Senza SMTP proprio, Supabase invia solo pochissime email e solo agli indirizzi del team.
4. **Supabase → Authentication → URL Configuration:** come *Site URL* mettere l'indirizzo del sito su Vercel.
