const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'spinvest-change-me-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'spinvest-admin-2026';
const MONGODB_URI = process.env.MONGODB_URI || '';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/ads.txt', (req, res) => {
  res.type('text/plain');
  res.send(process.env.ADS_TXT || 'google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0\n');
});

app.use(express.static(__dirname));

// —— NFT catalogue (in-site only) ——
// weeklyCap kept LOW so full exit takes many weeks
const NFTS = [
  { id: 'silver', name: 'Silver Bar', emoji: '🥈', price: 1000, weeklyCap: 40000, taskMin: 20, taskMax: 40, dailyTasks: 3, blurb: 'Starter access — not VIP (cannot refer yet)', vip: 0 },
  { id: 'vip1', name: 'VIP 1', emoji: '1️⃣', price: 5000, weeklyCap: 40000, taskMin: 80, taskMax: 120, dailyTasks: 4, blurb: 'First VIP — referrals unlocked', vip: 1 },
  { id: 'vip2', name: 'VIP 2', emoji: '2️⃣', price: 20000, weeklyCap: 40000, taskMin: 150, taskMax: 220, dailyTasks: 5, blurb: 'Gold-tier VIP access', vip: 2 },
  { id: 'vip3', name: 'VIP 3', emoji: '3️⃣', price: 45000, weeklyCap: 45000, taskMin: 250, taskMax: 380, dailyTasks: 6, blurb: 'Energy-tier VIP access', vip: 3 },
  { id: 'vip4', name: 'VIP 4', emoji: '4️⃣', price: 70000, weeklyCap: 50000, taskMin: 400, taskMax: 600, dailyTasks: 7, blurb: 'Estate-tier VIP access', vip: 4 },
  { id: 'vip5', name: 'VIP 5 · BTC', emoji: '₿', price: 100000, weeklyCap: 60000, taskMin: 700, taskMax: 1000, dailyTasks: 8, blurb: 'Highest VIP — Bitcoin vault', vip: 5 }
];


const NG_BANKS = [
  { name: 'Access Bank', code: '044' },
  { name: 'Citibank Nigeria', code: '023' },
  { name: 'Ecobank Nigeria', code: '050' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'First City Monument Bank', code: '214' },
  { name: 'Globus Bank', code: '00103' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Heritage Bank', code: '030' },
  { name: 'Jaiz Bank', code: '301' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Kuda Bank', code: '50211' },
  { name: 'Opay', code: '100004' },
  { name: 'PalmPay', code: '100033' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Stanbic IBTC Bank', code: '221' },
  { name: 'Standard Chartered Bank', code: '068' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'Union Bank of Nigeria', code: '032' },
  { name: 'United Bank For Africa', code: '033' },
  { name: 'Unity Bank', code: '215' },
  { name: 'VFD Microfinance Bank', code: '566' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' }
];

const INVEST_MIN = 5000;
const REF_PERCENT = 0.10; // 10% of referral deposit → main balance
const DAILY_RATE = 0.004; // 0.40% per day on investment balance
const DEC_BONUS = 0.05; // 5% instant in December

function lagosParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', hour12: false, weekday: 'short'
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return {
    day: Number(get('day')),
    month: Number(get('month')),
    hour: Number(get('hour')) % 24,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday')
  };
}

function todayKey() {
  return lagosParts().ymd;
}

// —— Schemas ——
const userSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 }, // main (tasks + referral + withdrawable mix tracked simply)
  invest_balance: { type: Number, default: 0 },
  nft_id: { type: String, default: null },
  nft_ids: { type: [String], default: [] },
  bank: { type: String, default: '' },
  account_number: { type: String, default: '' },
  account_name: { type: String, default: '' },
  referral_code: { type: String, unique: true, sparse: true },
  referred_by: { type: String, default: null },
  last_daily_credit: { type: String, default: null },
  created_at: { type: Date, default: Date.now }
});

const depositSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  user_id: { type: String, required: true, index: true },
  kind: { type: String, required: true }, // nft | invest
  item_id: { type: String, default: '' },
  amount: { type: Number, required: true },
  status: { type: String, default: 'pending' },
  referral_paid: { type: Boolean, default: false },
  paystack_ref: { type: String, default: '' },
  created_at: { type: Date, default: Date.now }
});

const withdrawSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  user_id: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  source: { type: String, default: 'main' }, // main | invest
  bank: { type: String, default: '' },
  account_number: { type: String, default: '' },
  status: { type: String, default: 'pending' },
  week_key: { type: String, default: '' },
  created_at: { type: Date, default: Date.now }
});

const taskDoneSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  user_id: { type: String, required: true, index: true },
  task_id: { type: Number, required: true },
  day_key: { type: String, required: true },
  completion_key: { type: String, unique: true },
  reward: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

const historySchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), unique: true },
  user_id: { type: String, required: true, index: true },
  type: { type: String, default: 'info' },
  title: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  status: { type: String, default: 'ok' },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('SpUser', userSchema);
const Deposit = mongoose.model('SpDeposit', depositSchema);
const Withdrawal = mongoose.model('SpWithdrawal', withdrawSchema);
const TaskDone = mongoose.model('SpTaskDone', taskDoneSchema);
const History = mongoose.model('SpHistory', historySchema);

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '90d' });
}

function authOptional(req, res, next) { next(); }

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired' });
  }
}

function adminAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (!p.admin) return res.status(403).json({ error: 'Admin only' });
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Admin only' });
  }
}

function publicUser(u) {
  const nft = NFTS.find((n) => n.id === u.nft_id) || null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    balance: u.balance,
    invest_balance: u.invest_balance,
    nft_id: u.nft_id,
    nft_ids: u.nft_ids || [],
    nft,
    vip: nft ? (nft.vip || 0) : 0,
    bank: u.bank,
    account_number: u.account_number,
    account_name: u.account_name,
    referral_code: u.referral_code
  };
}

async function applyDailyInvestCredit(user) {
  const day = todayKey();
  if (!user.invest_balance || user.invest_balance <= 0) return user;
  if (user.last_daily_credit === day) return user;
  const credit = Math.floor(Number(user.invest_balance) * DAILY_RATE);
  if (credit > 0) {
    user.invest_balance = Number(user.invest_balance) + credit;
    await History.create({
      id: uuidv4(),
      user_id: user.id,
      type: 'earning',
      title: 'Daily investment credit (0.40%)',
      amount: credit
    });
  }
  user.last_daily_credit = day;
  await user.save();
  return user;
}

function weekKey() {
  // ISO-ish week in Lagos: year + week number from day of year
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + week;
}

function weeklyCapFor(user) {
  const nft = NFTS.find((n) => n.id === user.nft_id);
  let cap = nft ? nft.weeklyCap : 0;
  if (user.invest_balance > 0) {
    const invCap = Math.max(40000, Math.floor(Number(user.invest_balance) * 0.1));
    cap = Math.max(cap, invCap);
  }
  // No NFT / no invest → no meaningful weekly room
  return cap || 0;
}

function userVipLevel(user) {
  const nft = NFTS.find((n) => n.id === user.nft_id);
  return nft ? (nft.vip || 0) : 0;
}

// —— Auth ——
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password, referral_code, bank, account_number, account_name, bank_code } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
    if (String(password).length < 4) return res.status(400).json({ error: 'Password too short' });
    if (!bank || !account_number || !account_name) {
      return res.status(400).json({ error: 'Verify your bank account to continue' });
    }
    if (!/^\d{10}$/.test(String(account_number).trim())) {
      return res.status(400).json({ error: 'Account number must be 10 digits' });
    }
    const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    let referredBy = null;
    if (referral_code) {
      const ref = await User.findOne({ referral_code: String(referral_code).trim().toUpperCase() });
      if (ref) referredBy = ref.id;
    }
    const myCode = 'SP' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      phone: (phone || '').trim(),
      password: bcrypt.hashSync(String(password), 10),
      bank: String(bank).trim(),
      account_number: String(account_number).trim(),
      account_name: String(account_name).trim(),
      referral_code: myCode,
      referred_by: referredBy
    });
    const token = sign(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('register', e);
    if (e && e.code === 11000) return res.status(400).json({ error: 'Email or referral code already exists' });
    res.status(500).json({ error: e.message || 'Register failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: String(email || '').toLowerCase() });
    if (!user || !bcrypt.compareSync(password || '', user.password)) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    await applyDailyInvestCredit(user);
    const token = sign(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  let user = await User.findOne({ id: req.user.id });
  if (!user) return res.status(404).json({ error: 'Not found' });
  user = await applyDailyInvestCredit(user);
  res.json(publicUser(user));
});

app.post('/api/profile/bank', auth, async (req, res) => {
  const { bank, account_number, account_name } = req.body;
  const user = await User.findOne({ id: req.user.id });
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.bank = (bank || '').trim();
  user.account_number = (account_number || '').trim();
  user.account_name = (account_name || '').trim();
  await user.save();
  res.json(publicUser(user));
});


let banksCache = null;
let banksCacheAt = 0;

async function fetchPaystackBanks() {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NG_BANKS.map((b) => ({ name: b.name, code: b.code }));
  const now = Date.now();
  if (banksCache && now - banksCacheAt < 6 * 60 * 60 * 1000) return banksCache;
  const r = await fetch('https://api.paystack.co/bank?country=nigeria&perPage=100', {
    headers: { Authorization: 'Bearer ' + secret }
  });
  const data = await r.json();
  if (!data.status || !Array.isArray(data.data)) {
    return NG_BANKS.map((b) => ({ name: b.name, code: b.code }));
  }
  banksCache = data.data
    .filter((b) => b.active !== false && b.code)
    .map((b) => ({ name: b.name, code: String(b.code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  banksCacheAt = now;
  return banksCache;
}

app.get('/api/banks', async (req, res) => {
  try {
    const list = await fetchPaystackBanks();
    res.json(list);
  } catch (e) {
    res.json(NG_BANKS.map((b) => ({ name: b.name, code: b.code })));
  }
});

app.get('/api/resolve-account', authOptional, async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(400).json({ error: 'Paystack key missing on server' });
    const account_number = String(req.query.account_number || '').trim();
    const bank_code = String(req.query.bank_code || '').trim();
    if (!/^\d{10}$/.test(account_number)) return res.status(400).json({ error: 'Enter a valid 10-digit account number' });
    if (!bank_code) return res.status(400).json({ error: 'Select your bank' });
    const r = await fetch(
      'https://api.paystack.co/bank/resolve?account_number=' + encodeURIComponent(account_number) + '&bank_code=' + encodeURIComponent(bank_code),
      { headers: { Authorization: 'Bearer ' + secret } }
    );
    const data = await r.json();
    if (!data.status || !data.data) {
      const msg = data.message || 'Could not verify account';
      // friendlier tip
      if (/bank code|not found/i.test(msg)) {
        return res.status(400).json({ error: 'Bank code not accepted. Pick the exact bank from the list (refresh page). Fintech apps may use a different listing name.' });
      }
      return res.status(400).json({ error: msg });
    }
    res.json({
      account_number: data.data.account_number,
      account_name: data.data.account_name,
      bank_id: data.data.bank_id
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Verify failed' });
  }
});


// —— Catalogue ——
app.get('/api/nfts', (req, res) => res.json(NFTS));

app.get('/api/promo', (req, res) => {
  const { month } = lagosParts();
  res.json({
    december: month === 12,
    investMin: INVEST_MIN,
    dailyRate: DAILY_RATE,
    decBonus: DEC_BONUS,
    refPercent: REF_PERCENT,
    bank: {
      name: process.env.BANK_NAME || 'UBA',
      account_number: process.env.BANK_ACCOUNT || '0232034481',
      account_name: process.env.BANK_ACCOUNT_NAME || 'Florence'
    },
    paystack: !!process.env.PAYSTACK_SECRET_KEY
  });
});

// —— Deposits ——
app.post('/api/deposits', auth, async (req, res) => {
  try {
    const { kind, item_id, amount } = req.body;
    if (kind === 'nft') {
      const nft = NFTS.find((n) => n.id === item_id);
      if (!nft) return res.status(400).json({ error: 'Invalid NFT' });
      const dep = await Deposit.create({
        id: uuidv4(),
        user_id: req.user.id,
        kind: 'nft',
        item_id: nft.id,
        amount: nft.price,
        status: 'pending'
      });
      return res.json({ id: dep.id, amount: nft.price, kind: 'nft', item: nft });
    }
    if (kind === 'invest') {
      const amt = Number(amount);
      if (!amt || amt < INVEST_MIN) return res.status(400).json({ error: 'Minimum investment ₦' + INVEST_MIN.toLocaleString() });
      const dep = await Deposit.create({
        id: uuidv4(),
        user_id: req.user.id,
        kind: 'invest',
        item_id: 'invest',
        amount: amt,
        status: 'pending'
      });
      return res.json({ id: dep.id, amount: amt, kind: 'invest' });
    }
    return res.status(400).json({ error: 'Invalid kind' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Deposit failed' });
  }
});

app.get('/api/deposits/mine', auth, async (req, res) => {
  const list = await Deposit.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(30).lean();
  res.json(list);
});

// —— Tasks ——
const TASK_POOL = [
  { id: 1, title: 'Market pulse check', desc: 'Review today’s headline rates for 30 seconds.' },
  { id: 2, title: 'Portfolio glance', desc: 'Open your wallet page and confirm balances.' },
  { id: 3, title: 'Invite reminder', desc: 'Copy your referral link once.' },
  { id: 4, title: 'Green glass focus', desc: 'Stay on the tasks screen for the timer.' },
  { id: 5, title: 'Security nod', desc: 'Confirm your email is correct on profile.' },
  { id: 6, title: 'Learn: compounding', desc: 'Read the short tip on daily credit.' },
  { id: 7, title: 'Liquidity check', desc: 'Note your weekly withdraw cap.' },
  { id: 8, title: 'Community pulse', desc: 'Open support / Telegram once.' }
];

app.get('/api/tasks', auth, async (req, res) => {
  const user = await User.findOne({ id: req.user.id });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const nft = NFTS.find((n) => n.id === user.nft_id);
  if (!nft) return res.json({ locked: true, tasks: [], message: 'Buy an NFT to unlock daily tasks' });
  const day = todayKey();
  const done = await TaskDone.find({ user_id: user.id, day_key: day }).lean();
  const doneIds = done.map((d) => d.task_id);
  const tasks = TASK_POOL.slice(0, nft.dailyTasks).map((t) => ({
    ...t,
    done: doneIds.includes(t.id),
    rewardLabel: `₦${nft.taskMin}–${nft.taskMax}`
  }));
  res.json({ locked: false, nft,
    vip: nft ? (nft.vip || 0) : 0, tasks, doneCount: doneIds.length });
});

app.post('/api/tasks/complete', auth, async (req, res) => {
  try {
    const task_id = Number(req.body.task_id);
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    const nft = NFTS.find((n) => n.id === user.nft_id);
    if (!nft) return res.status(400).json({ error: 'NFT required' });
    if (!TASK_POOL.some((t) => t.id === task_id) || task_id > nft.dailyTasks) {
      return res.status(400).json({ error: 'Invalid task' });
    }
    const day = todayKey();
    const completion_key = user.id + '_' + task_id + '_' + day;
    const reward = Math.floor(Math.random() * (nft.taskMax - nft.taskMin + 1)) + nft.taskMin;
    try {
      await TaskDone.create({
        id: uuidv4(),
        user_id: user.id,
        task_id,
        day_key: day,
        completion_key,
        reward
      });
    } catch (ce) {
      if (ce.code === 11000) return res.status(400).json({ error: 'Already completed today' });
      throw ce;
    }
    user.balance = Number(user.balance || 0) + reward;
    await user.save();
    await History.create({
      id: uuidv4(),
      user_id: user.id,
      type: 'earning',
      title: 'Task reward',
      amount: reward
    });
    res.json({ ok: true, reward, balance: user.balance });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed' });
  }
});

// —— Withdraw ——
app.post('/api/withdrawals', auth, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const source = req.body.source === 'invest' ? 'invest' : 'main';
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (!user.bank || !user.account_number) {
      return res.status(400).json({ error: 'Add bank details first' });
    }
    if (!amount || amount < 40000) return res.status(400).json({ error: 'Minimum withdraw ₦40,000 per week' });

    const cap = weeklyCapFor(user);
    if (!cap) return res.status(400).json({ error: 'No withdraw limit — buy NFT or invest first' });

    const wk = weekKey();
    const already = await Withdrawal.aggregate([
      { $match: { user_id: user.id, week_key: wk, status: { $in: ['pending', 'approved'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const used = (already[0] && already[0].total) || 0;
    if (used + amount > cap) {
      return res.status(400).json({
        error: `Weekly cap ₦${cap.toLocaleString()}. Already used ₦${used.toLocaleString()} this week.`
      });
    }

    if (source === 'invest') {
      if (amount > user.invest_balance) return res.status(400).json({ error: 'Insufficient investment balance' });
      user.invest_balance -= amount;
    } else {
      if (amount > user.balance) return res.status(400).json({ error: 'Insufficient main balance' });
      user.balance -= amount;
    }
    await user.save();
    const w = await Withdrawal.create({
      id: uuidv4(),
      user_id: user.id,
      amount,
      source,
      bank: user.bank,
      account_number: user.account_number,
      status: 'pending',
      week_key: wk
    });
    await History.create({
      id: uuidv4(),
      user_id: user.id,
      type: 'withdrawal',
      title: source + ' withdrawal',
      amount,
      status: 'pending'
    });
    res.json({ id: w.id, status: 'pending', weeklyCap: cap, used: used + amount });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Withdraw failed' });
  }
});

app.get('/api/history', auth, async (req, res) => {
  const list = await History.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(50).lean();
  res.json(list);
});

app.get('/api/referrals', auth, async (req, res) => {
  const list = await User.find({ referred_by: req.user.id }).select('name email created_at nft_id invest_balance').lean();
  res.json(list.map((u) => ({
    name: u.name,
    email: u.email,
    has_nft: !!u.nft_id,
    has_invest: Number(u.invest_balance) > 0,
    joined: u.created_at
  })));
});


async function creditApprovedDeposit(dep) {
  const user = await User.findOne({ id: dep.user_id });
  if (!user) return;
  if (dep.kind === 'nft') {
    const incoming = NFTS.find((n) => n.id === dep.item_id);
    const current = NFTS.find((n) => n.id === user.nft_id);
    // Upgrade only if same or higher price
    if (!current || (incoming && incoming.price >= current.price)) {
      user.nft_id = dep.item_id;
    }
    if (!user.nft_ids.includes(dep.item_id)) user.nft_ids.push(dep.item_id);
    await user.save();
    await History.create({
      id: uuidv4(), user_id: user.id, type: 'info',
      title: 'NFT / VIP unlocked: ' + dep.item_id, amount: dep.amount
    });
  } else if (dep.kind === 'invest') {
    let credit = Number(dep.amount);
    const { month } = lagosParts();
    if (month === 12) {
      const bonus = Math.floor(credit * DEC_BONUS);
      credit += bonus;
      await History.create({
        id: uuidv4(), user_id: user.id, type: 'earning',
        title: 'December +5% deposit bonus', amount: bonus
      });
    }
    user.invest_balance = Number(user.invest_balance || 0) + credit;
    await user.save();
    await History.create({
      id: uuidv4(), user_id: user.id, type: 'info',
      title: 'Investment credited', amount: credit
    });
  }
  if (user.referred_by && !dep.referral_paid) {
    const ref = await User.findOne({ id: user.referred_by });
    if (ref && userVipLevel(ref) >= 1) {
      const bonus = Math.floor(Number(dep.amount) * REF_PERCENT);
      if (bonus > 0) {
        ref.balance = Number(ref.balance || 0) + bonus;
        await ref.save();
        dep.referral_paid = true;
        await dep.save();
        await History.create({
          id: uuidv4(), user_id: ref.id, type: 'earning',
          title: 'Referral bonus (10%)', amount: bonus
        });
      }
    }
  }
}


// —— Paystack ——
app.post('/api/paystack/init', auth, async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(400).json({ error: 'Paystack not configured on server' });
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let amount = 0;
    let kind = req.body.kind;
    let item_id = req.body.item_id || '';
    if (kind === 'nft') {
      const nft = NFTS.find((n) => n.id === item_id);
      if (!nft) return res.status(400).json({ error: 'Invalid VIP/NFT' });
      amount = nft.price;
    } else if (kind === 'invest') {
      amount = Number(req.body.amount);
      if (!amount || amount < INVEST_MIN) return res.status(400).json({ error: 'Min invest ₦' + INVEST_MIN });
      item_id = 'invest';
    } else return res.status(400).json({ error: 'Invalid kind' });

    const dep = await Deposit.create({
      id: uuidv4(),
      user_id: user.id,
      kind,
      item_id,
      amount,
      status: 'pending'
    });

    const ref = 'SP' + dep.id.replace(/-/g, '').slice(0, 20);
    dep.paystack_ref = ref;
    await dep.save();

    const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(amount * 100), // kobo
        reference: ref,
        callback_url: (process.env.PUBLIC_URL || '') + '/?paid=' + encodeURIComponent(ref),
        metadata: { deposit_id: dep.id, user_id: user.id, kind, item_id }
      })
    });
    const initData = await initRes.json();
    if (!initData.status) {
      return res.status(400).json({ error: initData.message || 'Paystack init failed' });
    }
    res.json({
      deposit_id: dep.id,
      reference: ref,
      authorization_url: initData.data.authorization_url,
      access_code: initData.data.access_code
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Paystack error' });
  }
});

app.get('/api/paystack/verify', auth, async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(400).json({ error: 'Paystack not configured' });
    const reference = String(req.query.reference || '');
    if (!reference) return res.status(400).json({ error: 'Missing reference' });

    const vRes = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + secret }
    });
    const vData = await vRes.json();
    if (!vData.status || !vData.data || vData.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful yet' });
    }

    const dep = await Deposit.findOne({ paystack_ref: reference });
    if (!dep) return res.status(404).json({ error: 'Deposit not found' });
    if (dep.user_id !== req.user.id) return res.status(403).json({ error: 'Not your payment' });
    if (dep.status === 'approved') return res.json({ ok: true, already: true });

    // amount check (kobo)
    const paid = Number(vData.data.amount) / 100;
    if (paid < Number(dep.amount) - 1) {
      return res.status(400).json({ error: 'Amount mismatch' });
    }
    dep.status = 'approved';
    await dep.save();
    await creditApprovedDeposit(dep);
    res.json({ ok: true, deposit_id: dep.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Verify failed' });
  }
});

// —— Admin ——
app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(400).json({ error: 'Wrong password' });
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

app.get('/api/admin/deposits', adminAuth, async (req, res) => {
  const list = await Deposit.find({ status: 'pending' }).sort({ created_at: -1 }).lean();
  const out = [];
  for (const d of list) {
    const u = await User.findOne({ id: d.user_id });
    out.push({ ...d, user_name: u?.name, email: u?.email });
  }
  res.json(out);
});

app.post('/api/admin/deposits/:id/approve', adminAuth, async (req, res) => {
  const dep = await Deposit.findOne({ id: req.params.id });
  if (!dep || dep.status !== 'pending') return res.status(400).json({ error: 'Invalid' });
  dep.status = 'approved';
  await dep.save();
  await creditApprovedDeposit(dep);
  res.json({ ok: true });
});

app.post('/api/admin/deposits/:id/reject', adminAuth, async (req, res) => {
  await Deposit.updateOne({ id: req.params.id }, { status: 'rejected' });
  res.json({ ok: true });
});

app.get('/api/admin/withdrawals', adminAuth, async (req, res) => {
  const list = await Withdrawal.find({ status: 'pending' }).sort({ created_at: -1 }).lean();
  const out = [];
  for (const w of list) {
    const u = await User.findOne({ id: w.user_id });
    out.push({ ...w, user_name: u?.name, email: u?.email });
  }
  res.json(out);
});

app.post('/api/admin/withdrawals/:id/approve', adminAuth, async (req, res) => {
  await Withdrawal.updateOne({ id: req.params.id }, { status: 'approved' });
  res.json({ ok: true });
});

app.post('/api/admin/withdrawals/:id/reject', adminAuth, async (req, res) => {
  const w = await Withdrawal.findOne({ id: req.params.id });
  if (!w || w.status !== 'pending') return res.status(400).json({ error: 'Invalid' });
  w.status = 'rejected';
  await w.save();
  const user = await User.findOne({ id: w.user_id });
  if (user) {
    if (w.source === 'invest') user.invest_balance = Number(user.invest_balance || 0) + w.amount;
    else user.balance = Number(user.balance || 0) + w.amount;
    await user.save();
  }
  res.json({ ok: true });
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const users = await User.countDocuments();
  const pendingDep = await Deposit.countDocuments({ status: 'pending' });
  const pendingWd = await Withdrawal.countDocuments({ status: 'pending' });
  res.json({ users, pendingDep, pendingWd });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'Spinvest',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function start() {
  if (!MONGODB_URI) {
    console.error('Set MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB connected');
  app.listen(PORT, () => console.log('Spinvest on port ' + PORT));
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
