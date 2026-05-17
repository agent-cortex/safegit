export function renderApprovalPage(approvalId) {
  const escaped = String(approvalId).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SafeGit Approval ${escaped}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #09090b; color: #f4f4f5; }
    main { max-width: 920px; margin: 0 auto; padding: 40px 20px; }
    .card { border: 1px solid #27272a; background: #111113; border-radius: 18px; padding: 24px; box-shadow: 0 20px 80px rgba(0,0,0,.35); }
    h1 { margin: 0 0 6px; font-size: 30px; }
    .muted { color: #a1a1aa; }
    .grid { display: grid; grid-template-columns: 160px 1fr; gap: 10px 18px; margin: 24px 0; }
    code, pre { background: #18181b; border: 1px solid #27272a; border-radius: 10px; }
    code { padding: 2px 6px; overflow-wrap: anywhere; }
    pre { padding: 16px; overflow: auto; max-height: 320px; }
    button { appearance: none; border: 0; border-radius: 12px; padding: 12px 16px; font-weight: 700; cursor: pointer; }
    .primary { background: #22c55e; color: #052e16; }
    .secondary { background: #27272a; color: #f4f4f5; }
    .danger { color: #fca5a5; }
    .ok { color: #86efac; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  </style>
</head>
<body>
<main>
  <section class="card">
    <h1>SafeGit Approval</h1>
    <p class="muted">Approval ID: <code>${escaped}</code></p>
    <div id="status" class="muted">Loading approval…</div>
    <div id="details" class="grid" style="display:none"></div>
    <div class="row">
      <button id="connect" class="secondary">Connect wallet</button>
      <button id="sign" class="primary" disabled>Sign approval</button>
    </div>
    <h3>Typed payload</h3>
    <pre id="payload">{}</pre>
  </section>
</main>
<script>
const approvalId = ${JSON.stringify(approvalId)};
const statusEl = document.getElementById('status');
const detailsEl = document.getElementById('details');
const payloadEl = document.getElementById('payload');
const connectBtn = document.getElementById('connect');
const signBtn = document.getElementById('sign');
let approval;
let account;

function setStatus(text, kind='') {
  statusEl.className = kind || 'muted';
  statusEl.textContent = text;
}

function renderDetails(a) {
  const m = a.payload.message;
  detailsEl.style.display = 'grid';
  detailsEl.innerHTML = [
    ['Repo', m.repoHost + '/' + m.repoOwner + '/' + m.repoName],
    ['Branch', m.branch],
    ['Commit', m.commitSha],
    ['Author', m.author],
    ['Safe', m.safe],
    ['Status', a.status],
    ['Signatures', String((a.signatures || []).length)]
  ].map(([k,v]) => '<strong>' + k + '</strong><code>' + String(v) + '</code>').join('');
  payloadEl.textContent = JSON.stringify(a.payload, null, 2);
}

async function loadApproval() {
  const res = await fetch('/api/approvals/' + encodeURIComponent(approvalId));
  if (!res.ok) throw new Error('Approval not found');
  approval = await res.json();
  renderDetails(approval);
  setStatus('Ready. Connect the Safe owner wallet and sign.', 'muted');
}

connectBtn.onclick = async () => {
  if (!window.ethereum) { setStatus('No injected wallet found. Open in a wallet browser or install MetaMask/Rabby.', 'danger'); return; }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  account = accounts[0];
  connectBtn.textContent = account.slice(0,6) + '…' + account.slice(-4);
  signBtn.disabled = false;
};

signBtn.onclick = async () => {
  if (!approval || !account) return;
  setStatus('Requesting eth_signTypedData_v4…');
  const signature = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(approval.payload)]
  });
  setStatus('Submitting signature…');
  const res = await fetch('/api/approvals/' + encodeURIComponent(approvalId) + '/signatures', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signer: account, signature })
  });
  const out = await res.json();
  if (!res.ok) { setStatus(out.reason || out.error || 'Signature rejected', 'danger'); return; }
  setStatus(out.status === 'approved' ? 'Approved. Threshold reached.' : 'Signature accepted. More owners needed.', out.status === 'approved' ? 'ok' : 'muted');
  approval = await fetch('/api/approvals/' + encodeURIComponent(approvalId)).then(r => r.json());
  renderDetails(approval);
};

loadApproval().catch((err) => setStatus(err.message, 'danger'));
</script>
</body>
</html>`;
}
