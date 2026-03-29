<div align="center">

<br/>

```
  ____  _ _ _    ____                           _
 | __ )(_) | |  / ___| ___ _ __   ___ _ __ __ _| |_ ___  _ __
 |  _ \| | | | | |  _ / _ \ '_ \ / _ \ '__/ _` | __/ _ \| '__|
 | |_) | | | | | |_| |  __/ | | |  __/ | | (_| | || (_) | |
 |____/|_|_|_|  \____|\___|_| |_|\___|_|  \__,_|\__\___/|_|
```

# ⚡ Automated Sales Bill Generator

**Instant. Intelligent. Indian-market ready.**

[![Live Demo](https://img.shields.io/badge/🚀_Live_Demo-Visit_App-4CAF50?style=for-the-badge)](https://automated-sales-bill-generated.onrender.com)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![Deployed on Render](https://img.shields.io/badge/Deployed_on-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://render.com)

<br/>

> *Stop writing bills by hand. Let the machine do it — perfectly, every time.*

<br/>

### 🌐 [Live Demo → automated-sales-bill-generated.onrender.com](https://automated-sales-bill-generated.onrender.com)

<br/>

</div>

---

## 📌 What Is This?

**Automated Sales Bill Generator** is a lightweight, no-nonsense web application built for Indian retail businesses. It auto-generates professional sales bills on the fly — handling both **Cash** and **UPI** payment modes with smart, rule-based logic baked right in.

No more fumbling with templates. No more calculation errors. Just enter the details, pick a payment mode, and get a clean, ready-to-print bill in seconds.

---

## ✨ Features

| Feature | Description |
|---|---|
| 💵 **Cash Bills** | Auto-generated for transactions under ₹10,000 |
| 📲 **UPI Bills** | Captures exact UPI payment amount for seamless digital billing |
| ⚙️ **Auto Calculation** | Totals, taxes, and amounts computed instantly |
| 🖨️ **Print Ready** | Bills formatted cleanly for immediate printing |
| 🌐 **Web-Based** | Runs in any browser — no installations on client machines |
| ☁️ **Cloud Deployed** | Always-on via Render — accessible from anywhere |
| ⚡ **Lightweight** | Pure HTML + CSS + JS frontend with a minimal Node.js backend |

---

## 🧠 How It Works

```
User Enters Sale Details
        │
        ▼
  Payment Mode?
  ┌─────────────────────────────────┐
  │                                 │
Cash (< ₹10,000)              UPI Payment
  │                                 │
  ▼                                 ▼
Cash Bill Generated          UPI Bill Generated
with standard format      with exact UPI amount
        │                           │
        └──────────┬────────────────┘
                   ▼
         Clean, Printable Sales Bill
```

The system intelligently routes between **Cash** and **UPI** billing modes:
- **Cash** transactions are capped at ₹9,999 in compliance with common retail accounting norms.
- **UPI** bills capture the exact digital payment amount for transparent, auditable records.

---

## 🚀 Quick Start

### Option 1 — Use the Live App ☁️

No setup needed. Just visit:

**👉 [https://automated-sales-bill-generated.onrender.com](https://automated-sales-bill-generated.onrender.com)**

> **Note:** The app is hosted on Render's free tier — it may take **30–60 seconds** to wake up on the first load. Grab a chai ☕ and it'll be ready.

---

### Option 2 — Run Locally 🖥️

**Prerequisites:** [Node.js](https://nodejs.org/) v14+

```bash
# 1. Clone the repository
git clone https://github.com/Hardik21806/Automated-Sales-Bill-generated.git

# 2. Navigate into the project directory
cd Automated-Sales-Bill-generated

# 3. Install dependencies
npm install

# 4. Start the server
node index.js
```

Then open your browser at:

```
http://localhost:3000
```

---

## 📁 Project Structure

```
Automated-Sales-Bill-generated/
│
├── index.html          # Main UI — the billing interface
├── index.js            # Node.js server & core billing logic
├── style.css           # Styling for the bill and UI
├── package.json        # Project metadata & dependencies
├── package-lock.json   # Dependency lock file
└── .vscode/            # Editor configuration
```

---

## 💡 Use Cases

- 🛒 **Retail Shops** — Kirana stores, clothing shops, hardware stores
- 📦 **Small Businesses** — Quick billing without expensive POS software
- 🧾 **Sales Reps** — Generate client bills on the go from any browser
- 🏪 **Local Markets** — Dual-mode billing for cash-heavy and UPI-first environments

---

## 🛣️ Roadmap

- [ ] PDF export for bills
- [ ] GST/tax configuration support
- [ ] Customer database & history
- [ ] WhatsApp bill sharing integration
- [ ] Multi-language support (Hindi, Gujarati, etc.)
- [ ] Dark mode UI

---

## 🤝 Contributing

Contributions are welcome! Here's how to get involved:

```bash
# Fork the repo, then:
git checkout -b feature/your-feature-name
git commit -m "feat: add your feature"
git push origin feature/your-feature-name
# Open a Pull Request 🎉
```

Please keep code clean, comments meaningful, and PRs focused.

---

## 👨‍💻 Author

**Hardik** — [@Hardik21806](https://github.com/Hardik21806)

Built with purpose for the Indian retail ecosystem. 🇮🇳

---

## 📄 License

This project is licensed under the **MIT License** — free to use, modify, and distribute.

---

<div align="center">

**If this saved you time, drop a ⭐ on the repo. It means a lot.**

[🌐 Live App](https://automated-sales-bill-generated.onrender.com) · [🐛 Report Bug](https://github.com/Hardik21806/Automated-Sales-Bill-generated/issues) · [✨ Request Feature](https://github.com/Hardik21806/Automated-Sales-Bill-generated/issues)

<br/>

*Made with chai ☕ and code.*

</div>
