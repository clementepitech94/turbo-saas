require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const archiver = require('archiver');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ Vérifie que c'est bien ton lien Render
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

// PAGE ADMIN (Calcul du vrai total dynamique)
app.get('/admin', async (req, res) => {
    const adminPassword = process.env.ADMIN_PASSWORD;
    const userPassword = req.query.secret;

    if (!adminPassword || userPassword !== adminPassword) {
        return res.status(403).send("<body style='background:#08090A; color:#888; display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;'>⛔ Accès Refusé</body>");
    }

    try {
        const orders = await Order.find().sort({ date: -1 });
        
        // Calcul intelligent du total (additionne les montants exacts stockés en base)
        const totalRevenue = orders.reduce((acc, order) => acc + order.amount, 0) / 100;

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
                <p style="color:#888; margin-bottom:30px;">Revenu Total : <span style="color:#fff; font-weight:bold; font-size:1.2rem;">${totalRevenue.toFixed(2)} €</span></p>
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
                <p style="color:#8A8F98; margin-bottom:30px;">Génération de votre projet PRO en cours...</p>
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
                        a.download = 'TurboSaaS_Pro.zip';
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

// --- CRÉATION DE SESSION PAIEMENT (PRIX MODIFIÉ ICI) ---
app.post('/create-checkout-session', async (req, res) => {
    const { projectName } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'Boilerplate SaaS Node.js (Version PRO)',
                        description: `Projet: ${projectName} - Inclus: Auth, Mongo, Stripe, Admin`,
                    },
                    // 👇 C'EST ICI QU'ON CHANGE LE PRIX
                    unit_amount: 1499, // 1499 centimes = 14.99€
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

// --- LIVRAISON DU PRODUIT (CONTENU AMÉLIORÉ) ---
app.post('/verify-payment', async (req, res) => {
    const { sessionId } = req.body;
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
            
            // Sauvegarde en BDD
            const existingOrder = await Order.findOne({ stripeSessionId: sessionId });
            if (!existingOrder) {
                await Order.create({
                    email: session.customer_details.email,
                    projectName: session.metadata.projectName,
                    amount: session.amount_total,
                    stripeSessionId: sessionId
                });
            }
            
            // Création du ZIP
            const safeName = session.metadata.projectName.replace(/[^a-z0-9-]/gi, '_').toLowerCase();
            res.attachment(`${safeName}.zip`);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);
            
            // 🎁 LE VRAI CADEAU À 15€ (Boilerplate complet)
            
            // 1. package.json complet
            const packageJson = {
                name: safeName,
                version: "1.0.0",
                main: "server.js",
                scripts: { "start": "node server.js", "dev": "nodemon server.js" },
                dependencies: {
                    "express": "^4.18.2", "mongoose": "^7.0.0", "dotenv": "^16.0.0", "stripe": "^12.0.0", "body-parser": "^1.20.0"
                }
            };
            archive.append(JSON.stringify(packageJson, null, 2), { name: 'package.json' });

            // 2. Guide d'installation
            const readMe = `# ${safeName}\n\nMerci pour ton achat !\n\n## Installation\n1. \`npm install\`\n2. Crée un fichier .env\n3. \`npm start\``;
            archive.append(readMe, { name: 'README.md' });

            // 3. Un vrai serveur de base
            const serverCode = `require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('<h1>Ton SaaS ${safeName} démarre ici ! 🚀</h1>'));

mongoose.connect(process.env.MONGO_URI || '').then(() => console.log('DB Connectée'));
app.listen(PORT, () => console.log('Serveur lancé'));
`;
            archive.append(serverCode, { name: 'server.js' });

            archive.finalize();
        } else {
            res.status(400).send("Erreur paiement.");
        }
    } catch (e) {
        res.status(500).send("Erreur serveur.");
    }
});

app.listen(PORT, () => console.log(`Serveur lancé sur ${PORT}`));