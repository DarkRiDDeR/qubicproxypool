/* global */

/**
 * --------------------------------------------------------------------------
 * CoreUI Boostrap Admin Template main.js
 * Licensed under MIT (https://github.com/coreui/coreui-free-bootstrap-admin-template/blob/main/LICENSE)
 * --------------------------------------------------------------------------
 */

const initialEpoch = [103, 1712145600000]; // [number, timestamp in milliseconds]
const elEpochProgress = document.getElementById('epoch-progress');
if (elEpochProgress) {
  const tick = () => {
    const date = new Date();
    let progress = (date.getTime() - initialEpoch[1]) / 604800000;
    let epoch = Math.floor(progress);
    progress = Math.round((progress - epoch) * 10000) / 100;
    epoch += initialEpoch[0];
    elEpochProgress.style.width = `${progress}%`;
    elEpochProgress.querySelector('.value').textContent = `${epoch}: ${progress}%`;
  };
  tick();
  setInterval(tick, 60000);
}
const elFormsAuth = document.querySelectorAll('.form-auth');
for (const form of Array.prototype.slice.call(elFormsAuth)) {
  form.addEventListener('submit', e => (async e => {
    e.preventDefault();
    const form = e.currentTarget;
    let msgError = null;
    try {
      console.log([form.action, form.method]);
      const response = await fetch(form.action, {
        method: form.method,
        body: new FormData(form)
      })
      const result = await response.json();
      if (result.success) {
        window.location.href = result.success
      } else {
        msgError = result.message;
      }
    } catch (error) {
      msgError = 'Error processing data from the server';
    }
    if (msgError) {
      form.querySelector('.invalid-feedback').textContent = msgError;
      for (const input of form.querySelectorAll('input')) {
        input.classList.add('is-invalid');
      }
      form.classList.remove('was-validated');
    } else {
      for (const input of form.querySelectorAll('input')) {
        input.classList.remove('is-invalid');
      }
      form.classList.add('was-validated');
    }
  })(e));
}
//# sourceMappingURL=main.js.map