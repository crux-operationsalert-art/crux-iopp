/** Print / Save as PDF for the current screen, stamped with who printed it, when, and the filters applied (SOW 16.2). */
export function PrintStamp({ who, filters }: { who: string; filters: string }) {
  return <div className="print-stamp">CRUX · printed {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by {who} · {filters}</div>;
}
export const PrintButton = () => <button className="btn sm no-print" onClick={() => window.print()}>Print / PDF</button>;
