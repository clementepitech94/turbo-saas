document.getElementById('saasForm').addEventListener('submit', async (e) => {
    e.preventDefault(); // Empêche le rechargement de la page

    const submitBtn = document.querySelector('.btn-primary');
    const originalText = submitBtn.innerText;
    
    // 1. Changer le texte du bouton pour montrer que ça charge
    submitBtn.innerText = 'Génération en cours... ⚙️';
    submitBtn.disabled = true;

    // 2. Récupérer les données du formulaire
    const formData = {
        projectName: document.getElementById('projectName').value || 'mon-saas',
        options: Array.from(document.querySelectorAll('input[name="options"]:checked')).map(el => el.value)
    };

    try {
        // 3. Envoyer la demande au serveur (Backend)
        const response = await fetch('/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            // 4. Si c'est bon, on déclenche le téléchargement
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${formData.projectName}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            
            submitBtn.innerText = 'Téléchargement lancé ! 🚀';
        } else {
            alert("Erreur lors de la génération.");
            submitBtn.innerText = originalText;
        }
    } catch (err) {
        console.error(err);
        alert("Erreur de connexion au serveur.");
        submitBtn.innerText = originalText;
    }

    // Réactiver le bouton après 3 secondes
    setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
    }, 3000);
});