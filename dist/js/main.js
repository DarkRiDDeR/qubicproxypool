/* global */

/**
 * --------------------------------------------------------------------------
 * CoreUI Boostrap Admin Template main.js
 * Licensed under MIT (https://github.com/coreui/coreui-free-bootstrap-admin-template/blob/main/LICENSE)
 * --------------------------------------------------------------------------
 */

const initialEpoch = [103, 1712145600000] // [number, timestamp in milliseconds]
const elEpochProgress = document.getElementById('epoch-progress')
if (elEpochProgress) {
  const tick = () => {
    const date = new Date()
    let progress = (date.getTime() - initialEpoch[1]) / 604800000
    let epoch = Math.floor(progress)
    progress = Math.round((progress - epoch) * 10000) / 100
    epoch += initialEpoch[0]
    elEpochProgress.style.width = `${progress}%`
    elEpochProgress.querySelector('.value').textContent = `${epoch}: ${progress}%`
  }
  tick()
  setInterval(tick, 60000)
}

const elFormsAuth = document.querySelectorAll('.form-auth')
for (const form of Array.prototype.slice.call(elFormsAuth)) {
  form.addEventListener('submit', e => (async e => {
    e.preventDefault()
    const form = e.currentTarget
    let msgError = null
    try {
      console.log([form.action, form.method])
      const response = await fetch(form.action, {
        method: form.method,
        body: new FormData(form)
      })
      const result = await response.json()
      if (result.success) {
        window.location.href = result.success
      } else {
        msgError = result.message
      }
    } catch (error) {
      msgError = 'Error processing data from the server'
    }
    if (msgError) {
      form.querySelector('.invalid-feedback').textContent = msgError
      for (const input of form.querySelectorAll('input')) {
        input.classList.add('is-invalid')
      }
      form.classList.remove('was-validated')
    } else {
      for (const input of form.querySelectorAll('input')) {
        input.classList.remove('is-invalid')
      }
      form.classList.add('was-validated')
    }
  })(e))
}

/**
 *   tr.align-middle
      td User2.w6
 */
const elPanelWorkers = document.querySelector('#table-panel-workers tbody')
if (elPanelWorkers) {
  try {
    const tick = async () => {
      let res = await fetch('/api/receive/')
      res = await res.json()
      const tbody = document.createElement('tbody');
      for (const item of res) {
        const tr = document.createElement('tr')
        tr.classList.add('align-middle')
        tr.innerHTML = `<td>${item.alias}</td>`
          + `<td>${item.version.versionString}</td>`
          + `<td class="${!item.isActive ? 'text-bg-danger' : item.currentIts == 0 ? 'text-bg-warning' : ''}">${item.currentIts} It/s</td>`
          + `<td>${item.solutionsFound}</td>`
          + `<td>${item.lastActive}</td>`
          + `<td><span class="badge me-1 ${item.isActive ? 'bg-success' : 'bg-danger'}">${item.isActive.toString()}</span></td>`
        tbody.appendChild(tr)
      }
      elPanelWorkers.replaceWith(tbody)
    }
    tick()
    setInterval(tick, 60000)
  } catch (error) {
    msgError = 'Error processing data from the server'
  }
}
//# sourceMappingURL=main.js.map