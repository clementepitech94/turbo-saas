require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const archiver = require('archiver');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ Mettre ton vrai lien Render ici
const YOUR_DOMAIN = 'https://turbo-saas.onrender.com';

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- CONNEXION MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connecté'))
    .catch(err => console.error('❌ Erreur MongoDB:', err));

const OrderSchema = new mongoose.Schema({
    email: String,
    projectName: String,
    amount: Number,
    date: { type: Date, default: Date.now },
    stripeSessionId: String
});
const Order = mongoose.model('Order', OrderSchema);

// --- ROUTES ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// PAGE ADMIN (DESIGN DARK + FRANÇAIS)
app.get('/admin', async (req, res) => {
    const adminPassword = process.env.ADMIN_PASSWORD;
    const userPassword = req.query.secret;

    if (!adminPassword || userPassword !== adminPassword) {
        return res.status(403).send("<body style='background:#08090A; color:#888; display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;'>⛔ Accès Refusé</body>");
    }

    try {
        const orders = await Order.find().sort({ date: -1 });
        
        let html = `
            <html>
            <head>
                <title>Tableau de Bord Admin</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Inter', sans-serif; padding: 40px; background: #08090A; color: #eee; }
                    h1 { font-weight: 600; letter-spacing: -1px; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; background: #141516; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
                    th { text-align: left; padding: 15px; background: #1C1D21; color: #8A8F98; font-size: 0.85rem; text-transform: uppercase; }
                    td { padding: 15px; border-bottom: 1px solid #222; color: #ddd; font-size: 0.95rem; }
                    tr:last-child td { border-bottom: none; }
                    .tag { padding: 4px 8px; background: rgba(94, 106, 210, 0.2); color: #8E96FF; border-radius: 4px; font-size: 0.8rem; }
                </style>
            </head>
            <body>
                <h1>Tableau de Bord</h1>
                <p style="color:#888; margin-bottom:30px;">Revenu Total : <span style="color:#fff;">${orders.length * 9} €</span></p>
                <table>
                    <tr><th>Date</th><th>Client</th><th>Projet</th><th>Montant</th></tr>`;
        
        orders.forEach(order => {
            html += `
                <tr>
                    <td>${order.date.toLocaleString('fr-FR')}</td>
                    <td>${order.email}</td>
                    <td>${order.projectName}</td>
                    <td><span class="tag">${(order.amount / 100).toFixed(2)} €</span></td>
                </tr>`;
        });

        html += `</table></body></html>`;
        res.send(html);
    } catch (err) {
        res.send("Erreur Base de données");
    }
});

// PAGE SUCCÈS (DESIGN DARK + FRANÇAIS)
app.get('/success', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Commande Confirmée</title>
            <link rel="stylesheet" href="/css/style.css">
        </head>
        <body style="display:flex; justify-content:center; align-items:center; height:100vh; text-align:center;">
            <div class="configurator-card" style="text-align:center;">
                <div style="font-size:3rem; margin-bottom:20px;">🎉</div>
                <h1 style="margin-bottom:10px;">Paiement Validé</h1>
                <p style="color:#8A8F98; margin-bottom:30px;">Génération de votre projet en cours...</p>
                <p id="status" style="color:#5E6AD2; font-weight:600;">Lancement du téléchargement...</p>
            </div>
            <script>
                const urlParams = new URLSearchParams(window.location.search);
                const sessionId = urlParams.get('session_id');
                if (sessionId) {
                    fetch('/verify-payment', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ sessionId })
                    })
                    .then(res => res.blob())
                    .then(blob => {
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'TurboSaaS.zip';
                        document.body.appendChild(a);
                        a.click();
                        document.getElementById('status').innerText = "Téléchargement lancé !";
                        document.getElementById('status').style.color = "#4CAF50";
                    })
                    .catch(err => document.getElementById('status').innerText = "Erreur de téléchargement.");
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/cancel', (req, res) => res.send('<h1 style="color:white; text-align:center; margin-top:50px; font-family:sans-serif;">Paiement annulé.</h1><div style="text-align:center"><a href="/" style="color:#8E96FF">Retour</a></div>'));

app.post('/create-checkout-session', async (req, res) => {
    const { projectName, options } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'Boilerplate SaaS Node.js',
                        description: `Projet: ${projectName}`,
                    },
                    unit_amount: 900,
                },
                quantity: 1,
            }],
            mode: 'payment',
            metadata: { projectName: projectName },
            success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${YOUR_DOMAIN}/cancel`,
        });
        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/verify-payment', async (req, res) => {
    const { sessionId } = req.body;
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
            const existingOrder = await Order.findOne({ stripeSessionId: sessionId });
            if (!existingOrder) {
                await Order.create({
                    email: session.customer_details.email,
                    projectName: session.metadata.projectName,
                    amount: session.amount_total,
                    stripeSessionId: sessionId
                });
            }
            
            const safeName = session.metadata.projectName.replace(/[^a-z0-9-]/gi, '_').toLowerCase();
            res.attachment(`${safeName}.zip`);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);
            
            // Contenu du ZIP simulé
// --- C. LE VRAI CONTENU DU ZIP (BOILERPLATE PRO) ---
            
            // 1. Le fichier package.json (Avec toutes les dépendances)
            const packageJsonContent = {
                name: safeName,
                version: "1.0.0",
                main: "server.js",
                scripts: { "start": "node server.js", "dev": "nodemon server.js" },
                dependencies: {
                    "express": "^4.18.2",
                    "mongoose": "^7.0.3",
                    "dotenv": "^16.0.3",
                    "stripe": "^12.0.0",
                    "body-parser": "^1.20.2",
                    "cors": "^2.8.5"
                }
            };
            archive.append(JSON.stringify(packageJsonContent, null, 2), { name: 'package.json' });

            // 2. Le fichier .env d'exemple (Pour qu'il sache quoi configurer)
            const envExample = `PORT=3000
MONGO_URI=mongodb+srv://...
STRIPE_SECRET_KEY=sk_test_...
ADMIN_PASSWORD=change_me
`;
            archive.append(envExample, { name: '.env.example' });

            // 3. Le fichier server.js (UN VRAI SERVEUR COMPLET)
            const serverCode = `
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('✅ MongoDB Connecté'))
.catch(err => console.error('Erreur DB:', err));

// Route de base
app.get('/', (req, res) => {
    res.send('<h1>🚀 Ton SaaS ${session.metadata.projectName} est prêt !</h1><p>Commence à coder dans server.js</p>');
});

app.listen(PORT, () => console.log(\`Serveur lancé sur http://localhost:\${PORT}\`));
`;
            archive.append(serverCode, { name: 'server.js' });

            // 4. Le Guide d'installation
            const readMe = `
# ${session.metadata.projectName}
Généré par TurboSaaS.

## 🚀 Comment lancer ton projet ?

1. Installe les dépendances :
   \`npm install\`

2. Configure tes variables :
   - Renomme ".env.example" en ".env"
   - Ajoute ta clé MongoDB et Stripe.

3. Lance le serveur :
   \`npm start\`

Bon code !
`;
            archive.append(readMe, { name: 'README.md' });

            archive.finalize();
        } else {
            res.status(400).send("Erreur paiement.");
        }
    } catch (e) {
        res.status(500).send("Erreur serveur.");
    }
});

app.listen(PORT, () => console.log(`Serveur lancé sur ${PORT}`));