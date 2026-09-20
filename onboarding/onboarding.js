/**
 * Tethernet Onboarding / Consent Script
 */

const checkbox = document.getElementById('consent-checkbox');
const hintsCheckbox = document.getElementById('hints-checkbox');
const enableBtn = document.getElementById('enable-btn');

checkbox.addEventListener('change', () => {
  enableBtn.disabled = !checkbox.checked;
});

enableBtn.addEventListener('click', async () => {
  if (!checkbox.checked) return;

  // Decided here rather than left at 'ask'. A setting nobody is shown is a setting
  // nobody turns on, and this is the one moment the user is already reading the terms.
  await chrome.storage.local.set({
    tethernetConsent: true,
    tethernetHintsMode: hintsCheckbox.checked ? 'on' : 'off',
  });

  enableBtn.textContent = 'Enabled!';
  enableBtn.style.backgroundColor = '#28a745';

  setTimeout(() => window.close(), 800);
});

chrome.storage.local.get(['tethernetConsent', 'tethernetHintsMode']).then(({ tethernetConsent, tethernetHintsMode }) => {
  if (tethernetHintsMode) hintsCheckbox.checked = tethernetHintsMode === 'on';
  if (tethernetConsent) {
    checkbox.checked = true;
    enableBtn.disabled = false;
    enableBtn.textContent = 'Already Enabled';
    enableBtn.style.backgroundColor = '#28a745';
  }
});
