<<<<<<< HEAD
# Insight Engine — Setup Guide

## What you're deploying
- **Frontend** → Vercel (free)
- **Backend API** → Render (free)
- **Database** → Supabase (free)

---

## Step 1: Create accounts (10 min)

1. **GitHub** → github.com → Sign up
2. **Supabase** → supabase.com → Sign up with GitHub
3. **Render** → render.com → Sign up with GitHub
4. **Vercel** → vercel.com → Sign up with GitHub

---

## Step 2: Set up Supabase (5 min)

1. Go to supabase.com → New Project → name it "insight-engine"
2. Wait for it to provision (~2 min)
3. Go to **SQL Editor** → paste the contents of `supabase-schema.sql` → Run
4. Go to **Settings → API** → copy:
   - `Project URL` → this is your `SUPABASE_URL`
   - `service_role` key → this is your `SUPABASE_SERVICE_KEY`

---

## Step 3: Push code to GitHub (5 min)

1. Go to github.com → New repository → name it "insight-engine" → Create
2. Open Terminal on a Mac (or use GitHub's web editor on iPad):

```bash
cd ~/insight-engine
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/bcopans/insight-engine.git
git push -u origin main
```

**On iPad:** Use github.dev — go to your new empty repo and press `.` to open a web editor, then drag and drop the files.

---

## Step 4: Deploy backend to Render (5 min)

1. Go to render.com → New → Web Service
2. Connect your GitHub repo
3. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add environment variables:
   - `ANTHROPIC_API_KEY` → your Anthropic API key (console.anthropic.com)
   - `SUPABASE_URL` → from Step 2
   - `SUPABASE_SERVICE_KEY` → from Step 2
   - `FRONTEND_URL` → leave blank for now, update after Step 5
5. Deploy → copy the URL it gives you (e.g. `https://insight-engine-backend.onrender.com`)

---

## Step 5: Deploy frontend to Vercel (5 min)

1. Go to vercel.com → New Project → Import your GitHub repo
2. Settings:
   - **Root Directory:** `frontend`
   - **Framework:** Create React App
3. Add environment variable:
   - `REACT_APP_API_URL` → your Render backend URL from Step 4
4. Deploy → Vercel gives you a URL like `https://insight-engine.vercel.app`
5. Go back to Render → update `FRONTEND_URL` to your Vercel URL → Redeploy

---

## You're live!

Open your Vercel URL and the app is running. Sessions save to Supabase automatically.

---

## Your Anthropic API key

Get it at: console.anthropic.com → API Keys → Create Key

You'll need to add a payment method and add some credit ($5 minimum). Each analysis costs a fraction of a cent.
=======
# Insight-engine
Research synthesizer and roadmap evaluation tool
>>>>>>> fe473322a776ff006ef0813c880c3f93b43827ca
