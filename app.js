// Registrér service worker med korrekt scope for GitHub Pages
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/webkiosk-app/service-worker.js', { scope: '/webkiosk-app/' })
      .catch(console.warn);
  });
}

// (Intentionelt tom ift. at loade A – det håndteres nu i index.html for at kunne autodetektere)
