import { Link } from 'react-router-dom';
import { Me, select } from '../lib/api';
import { Card, Loading, useLoad } from '../components/ui';
import { Icon } from '../components/Icon';
import { Logo } from './Onboard';

/** About & privacy (D-108): what CRUX is, who runs it, what the app records and the permissions it uses — in clear words,
 *  not buried. This is also where the in-app activity recording is disclosed. */
export default function About({ me }: { me: Me }) {
  const c = me.company ?? ({} as any);
  const ag = useLoad(() => select('agreement_versions', 'version,title,body', (b) => b.eq('version', me.agreement_version)), [me.agreement_version]);
  const a = (ag.data ?? [])[0];
  const site = c.website ? (c.website.startsWith('http') ? c.website : `https://${c.website}`) : null;
  return (
    <div className="stack about">
      <section className="hero about-hero">
        <div className="hero-top"><div style={{ minWidth: 0 }}><div className="hero-date">About</div><h1 className="display hero-hello" style={{ fontSize: '2rem' }}>{c.name ?? 'CRUX'}</h1></div>
          <div className="about-logo"><Logo compact /></div></div>
        <p className="hero-sub" style={{ marginTop: 10 }}>CRUX Integrated Operations Productivity Platform — the daily operations, collections, targets and HR tool for the team.</p>
      </section>

      <Card title="Company">
        <div className="grid two">
          <div><span className="muted small">Name</span><div><b>{c.name ?? '—'}</b></div></div>
          <div><span className="muted small">Registered office</span><div>{c.address ?? c.place ?? '—'}</div></div>
          <div><span className="muted small">Website</span><div>{site ? <a href={site} target="_blank" rel="noopener noreferrer">{c.website}</a> : '—'}</div></div>
          <div><span className="muted small">What we do</span><div>Risk operations and field verification services for banks and financial institutions.</div></div>
        </div>
      </Card>

      <Card title="The app">
        <p>CRUX replaces the daily numbers that used to go on WhatsApp with one place to enter and see operations and collections, track targets and attendance, run payroll, and keep HR records. It works on your phone and installs like an app.</p>
        <p className="small muted">App version {me.agreement_version}. Your company administers it; for help use <Link to="/chat">Need help</Link> in Chat.</p>
      </Card>

      <Card title={<span>Your data &amp; privacy</span> as any} help="What the app records about you, who can see it, and what it cannot do.">
        <ul className="about-list">
          <li><b>Your work figures</b> (cases, collections, attendance) are recorded with who entered them and when, and are seen by you and your management line.</li>
          <li><b>Your profile and ID documents</b> (Aadhaar, PAN, bank, qualification, emergency contact) are used for employment, payroll and compliance, and the full details are visible only to you, HR and Admin (salary also to your reporting manager).</li>
          <li><b>Your activity in the app</b> (for example when you are active and whether you have installed it) is recorded so the company can run reminders and understand adoption. This is visible to HR and Admin.</li>
          <li><b>Each time you open the app</b>, the time, your device type, a device ID created by the app and your network address are recorded. Your location is recorded only if you have allowed location for this app. This is visible to Admin and the Auditor. The app cannot see your phone's IMEI, your other apps, your messages or your files.</li>
          <li><b>What the app cannot do:</b> CRUX is a web app. It cannot see other apps on your phone, your photos or gallery, your files, your location or your messages, and it does not try to. It only uses what is described here.</li>
          <li>Your data is handled in line with applicable law, including the Digital Personal Data Protection Act, 2023.</li>
        </ul>
      </Card>

      <Card title="Permissions the app asks for">
        <div className="about-perm"><span className="perm-ico" aria-hidden><Icon name="bell" size={20} /></span>
          <div><b>Notifications</b> <span className="pill bad small">required</span><div className="small muted">So reminders, tasks, approvals and messages reach you even when the app is closed. The app asks for this when you open it, and does not go further until it is on.</div></div></div>
        <div className="about-perm"><span className="perm-ico" aria-hidden><Icon name="user" size={20} /></span>
          <div><b>Camera</b> <span className="pill neutral small">when needed</span><div className="small muted">Only when you tap to scan a document (Aadhaar, PAN, cheque). Your phone asks the first time; you can also choose a photo instead.</div></div></div>
        <p className="small muted" style={{ marginTop: 8 }}>CRUX does not ask for your location, microphone, contacts, photos or files, because it does not use them.</p>
      </Card>

      <Card title="Terms and agreement">
        {ag.loading ? <Loading rows={2} /> : a ? <details><summary style={{ cursor: 'pointer' }}><b>{a.title}</b> <span className="muted small">— version {a.version}</span></summary>
          <div className="agreement" tabIndex={0} aria-label="Agreement text" style={{ marginTop: 10 }}>{a.body.split('\n\n').map((para: string, i: number) => <p key={i}>{para}</p>)}</div></details>
          : <p className="muted">The agreement could not be loaded.</p>}
        <p className="small muted">You accepted this when you first signed in. Your acceptance (date, time, network address and device) is on record.</p>
      </Card>

      <Card title="Policies">
        <ul className="about-list">
          <li><b>Confidentiality:</b> everything you see in CRUX is confidential and for your CRUX work only.</li>
          <li><b>Truthful reporting:</b> figures must be true, complete and on time; corrections are made in the app with a note.</li>
          <li><b>Leave &amp; holidays:</b> apply and see your balance under <Link to="/attendance">Attendance &amp; leave</Link>.</li>
          <li><b>Penalties:</b> only under an approved policy, recorded with a reason — see <Link to="/penalties">Penalties</Link>.</li>
          <li><b>Police verification:</b> compulsory for everyone; HR records it.</li>
        </ul>
      </Card>
    </div>
  );
}
