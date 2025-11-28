require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const archiver = require('archiver');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const YOUR_DOMAIN = 'https://turbo-saas.onrender.com'; // ⚠️ Ton lien Render

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// CONNEXION BDD (Pour ton SaaS à toi)
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Connecté'))
    .catch(err => console.error('❌ Erreur MongoDB:', err));

const OrderSchema = new mongoose.Schema({
    email: String, projectName: String, amount: Number, date: { type: Date, default: Date.now }, stripeSessionId: String
});
const Order = mongoose.model('Order', OrderSchema);

// --- ROUTES DU SAAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

app.get('/admin', async (req, res) => {
    const adminPassword = process.env.ADMIN_PASSWORD;
    const userPassword = req.query.secret;
    if (!adminPassword || userPassword !== adminPassword) return res.status(403).send("⛔ Accès Refusé");

    try {
        const orders = await Order.find().sort({ date: -1 });
        const totalRevenue = orders.reduce((acc, order) => acc + order.amount, 0) / 100;
        
        let html = `<html><head><title>Admin</title><style>body{font-family:sans-serif;background:#111;color:#eee;padding:20px}table{width:100%;border-collapse:collapse;background:#222}th,td{padding:10px;border:1px solid #333}</style></head><body><h1>Total: ${totalRevenue.toFixed(2)}€</h1><table>${orders.map(o => `<tr><td>${o.date.toLocaleString()}</td><td>${o.email}</td><td>${o.projectName}</td><td>${(o.amount/100).toFixed(2)}€</td></tr>`).join('')}</table></body></html>`;
        res.send(html);
    } catch (err) { res.send("Erreur DB"); }
});

app.get('/success', (req, res) => {
    res.send(`<html><body style="background:#08090A;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center"><div><h1>✅ Paiement Validé</h1><p id="status">Téléchargement...</p></div><script>const p=new URLSearchParams(window.location.search);const s=p.get('session_id');if(s){fetch('/verify-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s})}).then(r=>r.blob()).then(b=>{const u=window.URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='TurboSaaS_Ultimate.zip';document.body.appendChild(a);a.click();document.getElementById('status').innerText="Merci !";})}</script></body></html>`);
});

app.get('/cancel', (req, res) => res.redirect('/'));

app.post('/create-checkout-session', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: { name: 'SaaS Boilerplate ULTIMATE (MVC + Auth Ready)' },
                    unit_amount: 1499, // 14.99€
                },
                quantity: 1,
            }],
            mode: 'payment',
            metadata: { projectName: req.body.projectName },
            success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${YOUR_DOMAIN}/cancel`,
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- LE GÉNÉRATEUR PREMIUM ---
app.post('/verify-payment', async (req, res) => {
    const { sessionId } = req.body;
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
            const safeName = session.metadata.projectName.replace(/[^a-z0-9-]/gi, '_').toLowerCase();

            // Enregistrement vente
            const existing = await Order.findOne({ stripeSessionId: sessionId });
            if (!existing) await Order.create({ email: session.customer_details.email, projectName: safeName, amount: session.amount_total, stripeSessionId: sessionId });

            // CRÉATION DU ZIP ULTIMATE
            res.attachment(`${safeName}.zip`);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            // 1. Package.json (Avec Helmet et Cors en plus)
            const pkg = {
                name: safeName, version: "1.0.0", main: "server.js",
                scripts: { "start": "node server.js", "dev": "nodemon server.js" },
                dependencies: { "express": "^4.18.2", "mongoose": "^7.0.0", "dotenv": "^16.0.0", "stripe": "^12.0.0", "body-parser": "^1.20.0", "cors": "^2.8.5", "helmet": "^7.0.0" }
            };
            archive.append(JSON.stringify(pkg, null, 2), { name: 'package.json' });

            // 2. Structure MVC : Le Serveur Propre
            const serverJs = `require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de Sécurité & Utilitaires
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Connexion Base de données
mongoose.connect(process.env.MONGO_URI || '')
.then(() => console.log('✅ MongoDB Connecté'))
.catch(err => console.error('Erreur DB:', err));

// Routes
app.use('/', require('./routes/index'));

app.listen(PORT, () => console.log(\`🚀 Serveur lancé sur http://localhost:\${PORT}\`));
`;
            archive.append(serverJs, { name: 'server.js' });

            // 3. Dossier ROUTES (index.js)
            const routeIndex = `const router = require('express').Router();
const path = require('path');

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/index.html'));
});

// Exemple d'API
router.get('/api/status', (req, res) => {
    res.json({ status: 'online', message: 'Bienvenue sur votre API ${safeName}' });
});

module.exports = router;`;
            archive.append(routeIndex, { name: 'routes/index.js' });

            // 4. Dossier MODELS (User.js)
            const userModel = `const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);`;
            archive.append(userModel, { name: 'models/User.js' });

            // 5. Dossier VIEWS (index.html)
            const htmlView = `<!DOCTYPE html>
<html><head><title>${safeName}</title><link rel="stylesheet" href="/css/style.css"></head>
<body>
    <div class="container">
        <h1>🚀 ${safeName} est en ligne !</h1>
        <p>Architecture MVC chargée avec succès.</p>
        <div class="card">
            <h3>Prochaines étapes :</h3>
            <ul>
                <li>Modifiez <code>routes/index.js</code> pour vos pages</li>
                <li>Modifiez <code>models/User.js</code> pour vos données</li>
                <li>Ajoutez votre style dans <code>public/css/style.css</code></li>
            </ul>
        </div>
    </div>
</body></html>`;
            archive.append(htmlView, { name: 'views/index.html' });

            // 6. Dossier PUBLIC (style.css)
            const cssFile = `body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f7; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
.container { text-align: center; }
.card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: left; margin-top: 20px; }
li { margin-bottom: 10px; color: #555; }
h1 { color: #111; }`;
            archive.append(cssFile, { name: 'public/css/style.css' });

            // 7. Fichier .gitignore (Indispensable)
            archive.append(`node_modules\n.env\n.DS_Store`, { name: '.gitignore' });

            // 8. Fichier .env.example
            archive.append(`PORT=3000\nMONGO_URI=mongodb+srv://...\nSTRIPE_KEY=...`, { name: '.env.example' });

            archive.finalize();
        } else { res.status(400).send("Erreur paiement"); }
    } catch (e) { res.status(500).send("Erreur serveur"); }
});

app.listen(PORT, () => console.log(`Serveur ${PORT}`));