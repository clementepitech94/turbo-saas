// VERSION SECURISEE V2
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const archiver = require('archiver');
const mongoose = require('mongoose');
// Initialisation de Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ IMPORTANT : Vérifie que c'est bien ton adresse Render ici 👇
const YOUR_DOMAIN = 'https://turbo-saas.onrender.com';

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- 1. CONNEXION BASE DE DONNÉES (MongoDB) ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connecté'))
    .catch(err => console.error('❌ Erreur MongoDB:', err));

// Modèle de donnée (À quoi ressemble une vente ?)
const OrderSchema = new mongoose.Schema({
    email: String,
    projectName: String,
    amount: Number,
    date: { type: Date, default: Date.now },
    stripeSessionId: String
});
const Order = mongoose.model('Order', OrderSchema);

// --- 2. ROUTES D'AFFICHAGE ---

// Page d'accueil
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// PAGE ADMIN SECRÈTE (DESIGN LINEAR)
app.get('/admin', async (req, res) => {
    const adminPassword = process.env.ADMIN_PASSWORD;
    const userPassword = req.query.secret;

    if (!adminPassword || userPassword !== adminPassword) {
        return res.status(403).send("<body style='background:#08090A; color:#888; display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;'>⛔ Access Denied</body>");
    }

    try {
        const orders = await Order.find().sort({ date: -1 });
        
        let html = `
            <html>
            <head>
                <title>Admin Dashboard</title>
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
                <h1>Admin Overview</h1>
                <p style="color:#888; margin-bottom:30px;">Total Revenue: <span style="color:#fff;">${orders.length * 9} €</span></p>
                <table>
                    <tr><th>Date</th><th>Customer</th><th>Project</th><th>Amount</th></tr>`;
        
        orders.forEach(order => {
            html += `
                <tr>
                    <td>${order.date.toLocaleString()}</td>
                    <td>${order.email}</td>
                    <td>${order.projectName}</td>
                    <td><span class="tag">${(order.amount / 100).toFixed(2)} €</span></td>
                </tr>`;
        });

        html += `</table></body></html>`;
        res.send(html);
    } catch (err) {
        res.send("DB Error");
    }
});
// Page de succès après paiement
app.get('/success', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Order Confirmed</title>
            <link rel="stylesheet" href="/css/style.css">
        </head>
        <body style="display:flex; justify-content:center; align-items:center; height:100vh; text-align:center;">
            <div class="configurator-card" style="text-align:center;">
                <div style="font-size:3rem; margin-bottom:20px;">🎉</div>
                <h1 style="margin-bottom:10px;">Payment Successful</h1>
                <p style="color:#8A8F98; margin-bottom:30px;">Your boilerplate is being generated...</p>
                <p id="status" style="color:#5E6AD2; font-weight:600;">Initializing download...</p>
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
                        document.getElementById('status').innerText = "Download Started!";
                        document.getElementById('status').style.color = "#4CAF50";
                    })
                    .catch(err => document.getElementById('status').innerText = "Download Error.");
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/cancel', (req, res) => res.send('<h1>Paiement annulé.</h1><a href="/">Retour</a>'));

// --- 3. API : CRÉATION SESSION STRIPE ---
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
                    unit_amount: 900, // 9.00€
                },
                quantity: 1,
            }],
            mode: 'payment',
            metadata: { 
                projectName: projectName 
            },
            success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${YOUR_DOMAIN}/cancel`,
        });

        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- 4. API : VÉRIFICATION ET TÉLÉCHARGEMENT ---
app.post('/verify-payment', async (req, res) => {
    const { sessionId } = req.body;

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === 'paid') {
            // A. SAUVEGARDE EN BASE DE DONNÉES
            // On vérifie si la commande existe déjà pour ne pas l'enregistrer 2 fois
            const existingOrder = await Order.findOne({ stripeSessionId: sessionId });
            
            if (!existingOrder) {
                await Order.create({
                    email: session.customer_details.email,
                    projectName: session.metadata.projectName,
                    amount: session.amount_total,
                    stripeSessionId: sessionId
                });
                console.log(`💰 Vente enregistrée pour : ${session.customer_details.email}`);
            }

            // B. GÉNÉRATION DU ZIP
            const safeName = session.metadata.projectName.replace(/[^a-z0-9-]/gi, '_').toLowerCase();
            res.attachment(`${safeName}.zip`);

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            // Contenu du ZIP simulé
            const packageJsonContent = {
                name: safeName,
                version: "1.0.0",
                description: "Ton SaaS généré",
                scripts: { "start": "node server.js" }
            };
            
            archive.append(JSON.stringify(packageJsonContent, null, 2), { name: 'package.json' });
            archive.append(`console.log("Merci pour tes 9€ ! Ton projet ${safeName} commence ici.");`, { name: 'server.js' });
            archive.append(`# ${safeName}\n\nMerci pour ton achat !`, { name: 'README.md' });

            archive.finalize();
        } else {
            res.status(400).send("Paiement non validé par Stripe.");
        }
    } catch (e) {
        console.error("Erreur verify-payment:", e);
        res.status(500).send("Erreur serveur interne.");
    }
});

// --- DÉMARRAGE ---
app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});