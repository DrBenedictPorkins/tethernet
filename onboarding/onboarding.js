/**
 * Tethernet Onboarding / Consent Script
 */

const checkbox = document.getElementById('consent-checkbox');
const enableBtn = document.getElementById('enable-btn');

checkbox.addEventListener('change', () => {
  enableBtn.disabled = !checkbox.checked;
});

enableBtn.addEventListener('click', async () => {
  if (!checkbox.checked) return;

  await chrome.storage.local.set({ tetherwebConsent: true });

  enableBtn.textContent = 'Enabled!';
  enableBtn.style.backgroundColor = '#28a745';

  setTimeout(() => window.close(), 800);
});

chrome.storage.local.get('tetherwebConsent').then(({ tetherwebConsent }) => {
  if (tetherwebConsent) {
    checkbox.checked = true;
    enableBtn.disabled = false;
    enableBtn.textContent = 'Already Enabled';
    enableBtn.style.backgroundColor = '#28a745';
  }
});
