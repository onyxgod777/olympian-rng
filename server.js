const express = require('express');
const path = require('path');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const { PumpAgent } = require('@pump-fun/agent-payments-sdk');

// Load env (conditional — Railway uses its own env vars)
const envPath = path.join(__dirname, '.env.local');
const fs = require('fs');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
  console.log('Loaded .env.local');
}

const app = express();
app.use(express.json());

// CORS — allow any origin for Railway
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3456;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://rpc.solanatracker.io/public';
const AGENT_MINT = new PublicKey(process.env.AGENT_TOKEN_MINT_ADDRESS);
const CURRENCY_MINT = new PublicKey(process.env.CURRENCY_MINT);
const PRICE_AMOUNT = process.env.PRICE_AMOUNT || '100000000';
const priceSol = (Number(PRICE_AMOUNT) / 1e9).toFixed(2);

// ─── API: Build Transaction ───────────────────────────────────────────────
app.post('/api/build-tx', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });

    const memo = Math.floor(Math.random() * 900000000000) + 100000;
    const now = Math.floor(Date.now() / 1000);
    const startTime = now;
    const endTime = now + 86400;

    const connection = new Connection(RPC_URL, 'confirmed');
    const agent = new PumpAgent(AGENT_MINT, 'mainnet', connection);
    const user = new PublicKey(walletAddress);

    const instructions = await agent.buildAcceptPaymentInstructions({
      user,
      currencyMint: CURRENCY_MINT,
      amount: PRICE_AMOUNT,
      memo: memo.toString(),
      startTime: startTime.toString(),
      endTime: endTime.toString(),
    });

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = user;
    tx.add(...instructions);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    res.json({ transaction: serialized, memo, startTime, endTime, amount: PRICE_AMOUNT });
  } catch (err) {
    console.error('build-tx error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Verify Payment ──────────────────────────────────────────────────
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { walletAddress, memo, startTime, endTime, amount } = req.body;
    if (!walletAddress || memo === undefined || !startTime || !endTime || !amount) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const agent = new PumpAgent(AGENT_MINT);
    const verified = await agent.validateInvoicePayment({
      user: new PublicKey(walletAddress),
      currencyMint: CURRENCY_MINT,
      amount: Number(amount),
      memo: Number(memo),
      startTime: Number(startTime),
      endTime: Number(endTime),
    });

    // Retry loop for delayed propagation
    if (!verified) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const retry = await agent.validateInvoicePayment({
          user: new PublicKey(walletAddress),
          currencyMint: CURRENCY_MINT,
          amount: Number(amount),
          memo: Number(memo),
          startTime: Number(startTime),
          endTime: Number(endTime),
        });
        if (retry) return res.json({ verified: true });
      }
    }

    res.json({ verified });
  } catch (err) {
    console.error('verify error:', err);
    res.json({ verified: false, error: err.message });
  }
});

// ─── Serve Static HTML ────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OLYMPIAN RNG - Pay & Roll</title>
<script src="https://unpkg.com/@solana/web3.js@1.98.0/lib/index.iife.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    background: linear-gradient(135deg, #0a0a12 0%, #1a1a2e 50%, #16213e 100%);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 24px;
  }
  .hero { text-align: center; margin-bottom: 40px; }
  .hero h1 {
    font-size: 3rem; font-weight: 900;
    background: linear-gradient(135deg, #ffd700, #ff6b35);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    margin-bottom: 8px;
  }
  .hero p { color: rgba(255,255,255,0.6); font-size: 1.1rem; }
  .hero p strong { color: #ffd700; }
  
  .card {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,215,0,0.15);
    border-radius: 16px; padding: 32px;
    min-width: 360px; max-width: 480px; width: 100%;
    text-align: center;
  }
  
  button {
    padding: 14px 40px; font-size: 1.1rem; font-weight: 700;
    background: linear-gradient(135deg, #ffd700, #ff6b35);
    border: none; border-radius: 12px; color: #0a0a12;
    cursor: pointer; transition: transform 0.2s;
  }
  button:hover { transform: scale(1.05); }
  button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  
  .status-box {
    margin-top: 24px; padding: 24px;
    background: rgba(255,255,255,0.03);
    border-radius: 12px; border: 1px solid rgba(255,215,0,0.1);
  }
  .status-icon { font-size: 2.5rem; margin-bottom: 12px; }
  .status-text { color: rgba(255,255,255,0.8); font-size: 0.95rem; }
  .error-text { color: #ff6b6b; }
  
  .result-card {
    margin-top: 24px; padding: 36px;
    background: linear-gradient(135deg, rgba(255,215,0,0.1), rgba(255,107,53,0.1));
    border-radius: 20px; border: 2px solid rgba(255,215,0,0.3);
    text-align: center; min-width: 360px;
    box-shadow: 0 0 40px rgba(255,215,0,0.1);
  }
  .result-label {
    color: rgba(255,215,0,0.6); font-size: 0.85rem;
    text-transform: uppercase; letter-spacing: 3px; margin-bottom: 8px;
  }
  .result-number {
    font-size: 5rem; font-weight: 900;
    background: linear-gradient(135deg, #ffd700, #ff6b35, #ffd700);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    line-height: 1; margin-bottom: 8px;
  }
  .result-sub { color: rgba(255,255,255,0.4); font-size: 0.85rem; }
  
  .wallet-section { margin-bottom: 20px; }
  .footer { margin-top: 48px; color: rgba(255,255,255,0.15); font-size: 0.8rem; text-align: center; }
  
  .secondary-btn {
    margin-top: 16px; padding: 10px 24px;
    background: rgba(255,215,0,0.15); border: 1px solid rgba(255,215,0,0.3);
    border-radius: 8px; color: #ffd700; cursor: pointer; font-size: 0.9rem;
    transition: background 0.2s;
  }
  .secondary-btn:hover { background: rgba(255,215,0,0.25); }
  
  .connect-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: #fff; padding: 12px 32px; border-radius: 10px;
    cursor: pointer; font-size: 1rem; transition: background 0.2s;
  }
  .connect-btn:hover { background: rgba(255,255,255,0.2); }
  .connected-info {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 20px; background: rgba(255,215,0,0.1);
    border-radius: 10px; font-size: 0.85rem; font-family: monospace;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .dot.green { background: #4ade80; }
  .dot.red { background: #ff6b6b; }
</style>
</head>
<body>

<div class="hero">
  <h1>OLYMPIAN RNG</h1>
  <p>Pay <strong>${priceSol} SOL</strong> to roll a random number between <strong>0</strong> and <strong>1000</strong></p>
</div>

<div class="card" id="app">
  <div class="wallet-section" id="walletSection">
    <button class="connect-btn" id="connectBtn">Connect Wallet</button>
    <div id="walletInfo" style="display:none;"></div>
  </div>
  
  <div id="actionSection" style="display:none;">
    <button id="payBtn">⚡ Pay ${priceSol} SOL & Roll</button>
  </div>
  
  <div id="statusArea"></div>
  <div id="resultArea"></div>
</div>

<div class="footer">Powered by \\$OLYMP &bull; Pump.fun Agent Payments SDK</div>

<script>
const solWeb3 = window.solanaWeb3;
const { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } = solWeb3;

let wallet = null;
let publicKey = null;

// ─── Wallet Connect ─────────────────────────────────────────────────────────
async function connectWallet() {
  // Try modern Phantom (window.phantom)
  const provider = window.phantom?.solana || window.solana;
  
  if (!provider) {
    showStatus('error', 'No Solana wallet found. Install Phantom or Backpack.');
    return;
  }
  
  try {
    // Request connection — some wallets need this on HTTPS
    if (provider.isConnected && !provider.isConnected()) {
      await provider.connect();
    }
    const resp = await provider.connect();
    publicKey = new PublicKey(resp.publicKey.toString());
    wallet = provider;
    showConnected();
  } catch (e) {
    showStatus('error', 'Connection rejected: ' + e.message);
  }
}

function showConnected() {
  const addr = publicKey.toBase58();
  document.getElementById('connectBtn').style.display = 'none';
  const info = document.getElementById('walletInfo');
  info.style.display = 'block';
  info.innerHTML = '<span class="connected-info"><span class="dot green"></span> ' + addr.slice(0,4) + '...' + addr.slice(-4) + '</span>';
  document.getElementById('actionSection').style.display = 'block';
}

document.getElementById('connectBtn').addEventListener('click', connectWallet);

// ─── Pay & Roll ─────────────────────────────────────────────────────────────
document.getElementById('payBtn').addEventListener('click', payAndRoll);

async function payAndRoll() {
  if (!wallet || !publicKey) return;
  setUIState('building');
  
  try {
    // 1. Build transaction from server
    const buildRes = await fetch('/api/build-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
    });
    if (!buildRes.ok) throw new Error('Failed to build transaction');
    const { transaction: txBase64, memo, startTime, endTime, amount } = await buildRes.json();
    
    // 2. Sign
    setUIState('signing');
    const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
    const signedTx = await wallet.signTransaction(tx);
    
    // 3. Send
    setUIState('sending');
    const connection = new Connection('${RPC_URL}', 'confirmed');
    const sig = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false, preflightCommitment: 'confirmed',
    });
    const blockhash = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature: sig, ...blockhash }, 'confirmed');
    
    // 4. Verify server-side
    setUIState('verifying');
    const verifyRes = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: publicKey.toBase58(), memo, startTime, endTime, amount }),
    });
    const { verified } = await verifyRes.json();
    
    if (!verified) {
      throw new Error('Payment verification failed');
    }
    
    // 5. Generate random number (client-side, but gated by server verification)
    setUIState('confirmed');
    const num = Math.floor(Math.random() * 1001);
    showResult(num);
    
  } catch (err) {
    setUIState('idle');
    showStatus('error', err.message || 'Something went wrong');
  }
}

// ─── UI Helpers ─────────────────────────────────────────────────────────────
function setUIState(state) {
  const statusArea = document.getElementById('statusArea');
  const resultArea = document.getElementById('resultArea');
  const payBtn = document.getElementById('payBtn');
  
  resultArea.innerHTML = '';
  
  if (state === 'idle') {
    statusArea.innerHTML = '';
    payBtn.disabled = false;
    return;
  }
  
  payBtn.disabled = true;
  
  const icons = { building: '🔨', signing: '✍️', sending: '📡', verifying: '🔍', confirmed: '✅', error: '❌' };
  const texts = {
    building: 'Building payment transaction...',
    signing: 'Approve in your wallet...',
    sending: 'Sending transaction...',
    verifying: 'Verifying payment on-chain...',
    confirmed: '',
    error: '',
  };
  
  statusArea.innerHTML = '<div class="status-box"><div class="status-icon">' + icons[state] + '</div><div class="status-text">' + texts[state] + '</div></div>';
}

function showStatus(type, msg) {
  const statusArea = document.getElementById('statusArea');
  const payBtn = document.getElementById('payBtn');
  const icon = type === 'error' ? '❌' : '⚠️';
  statusArea.innerHTML = '<div class="status-box"><div class="status-icon">' + icon + '</div><div class="status-text ' + (type === 'error' ? 'error-text' : '') + '">' + msg + '</div>'
    + '<button class="secondary-btn" onclick="resetApp()">Try Again</button></div>';
  payBtn.disabled = false;
}

function showResult(num) {
  document.getElementById('statusArea').innerHTML = '';
  document.getElementById('payBtn').disabled = false;
  document.getElementById('resultArea').innerHTML = 
    '<div class="result-card">'
    + '<div class="result-label">Your Random Number</div>'
    + '<div class="result-number">' + num + '</div>'
    + '<div class="result-sub">0\u20131000 &bull; Payment verified ✅</div>'
    + '<button class="secondary-btn" onclick="resetApp()">Roll Again</button>'
    + '</div>';
}

function resetApp() {
  document.getElementById('statusArea').innerHTML = '';
  document.getElementById('resultArea').innerHTML = '';
  document.getElementById('payBtn').disabled = false;
}
</script>
</body>
</html>`);
});

process.on('uncaughtException', (err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('OLYMPIAN RNG server running on http://0.0.0.0:' + PORT);
  console.log('RPC:', RPC_URL);
  console.log('Agent Mint:', AGENT_MINT.toBase58());
  console.log('Price:', priceSol, 'SOL');
});
