# Run CaseLight on your laptop (5 steps)

The app has to run on your own computer, because Clio sends you back to `http://127.0.0.1:3000/callback` after you log in, and that address means "this computer".

## 1. Install Node (once)
Go to https://nodejs.org, click the big **LTS** button, install it like any app.

## 2. Unzip
Download `CaseLight.zip` from the project and double-click it. You get a folder called `caselight`.

## 3. Put your keys in
In the `caselight` folder, open `.env.example` with any text editor (Notepad, TextEdit).
- After `CLIO_CLIENT_ID=` paste your Clio client id.
- After `CLIO_CLIENT_SECRET=` paste your Clio client secret.
- Optional: remove the `#` before `ANTHROPIC_API_KEY=` and paste your Anthropic key after it (step 6).

Save it as a new file named exactly `.env` (with the dot, no `.txt` at the end).

## 4. Start it
Open a terminal in the `caselight` folder:
- **Mac:** right-click the folder in Finder, then Services, then "New Terminal at Folder".
- **Windows:** open the folder, click the address bar, type `cmd`, press Enter.

Type this and press Enter:
```
npm start
```
Leave that window open.

## 5. Open it
Go to http://127.0.0.1:3000 in your browser. The first load takes about 10 seconds.
Click **Connect Clio** (top right), log in to Clio, click **Allow**. You come back to CaseLight, now reading your real Clio account.

## 6. Anthropic API key (optional, makes Ask and the summary written by Claude)
1. Go to https://console.anthropic.com and sign in (or sign up).
2. Click **Settings**, then **Billing**, and add a few dollars of credit (one case costs about $0.40).
3. Click **API Keys**, then **Create Key**, give it any name, then **Copy**.
4. Paste it into `.env` after `ANTHROPIC_API_KEY=` (no `#` in front). Save.
5. In the terminal press Ctrl+C, then type `npm start` again.

Never share the `.env` file or post the keys anywhere.
