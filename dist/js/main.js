/* global */

/**
 * --------------------------------------------------------------------------
 * CoreUI Boostrap Admin Template main.js
 * Licensed under MIT (https://github.com/coreui/coreui-free-bootstrap-admin-template/blob/main/LICENSE)
 * --------------------------------------------------------------------------
 */

let totalSolutions = 0
function initSolsChart() {
  const elSolsChart = document.getElementById('canvasSolsChart')
    if (elSolsChart) {
      return new Chart(document.getElementById('canvasSolsChart'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            cubicInterpolationMode: 'monotone',
            backgroundColor: 'rgba(237,173,33,0.2)',
            borderColor: 'rgba(237,173,33,1)',
            pointBackgroundColor: 'rgba(237,173,33,1)',
            pointBorderColor: '#fff',
            fill: true,
            pointStyle: 'circle',
            pointRadius: 3,
            pointHoverRadius: 5,
            data: [],
            spanGaps: true
          }]
        },
        options: {
          plugins: {
            legend: {
              display: false
            }
          },
          responsive: true
        }
      })
    }
  return null
}

async function updateSolsChart (chart) {
  const labels = []
  const values = []
  let res = await fetch('/api/solutions/')
  res = Object.entries(await res.json())
  if (res) {
    for(let [t, v] of res) {
      const d = new Date(t*1000) 
      labels.push(d.toLocaleString('en-us',{timeZone:'UTC',weekday:'short',hourCycle: 'h23',hour:'2-digit',minute:'2-digit'}))
      if (values.length && !v) v = null
      values.push(v)
    }
    chart.data.labels = labels
    chart.data.datasets[0].data = values
    chart.update()
  }    
}

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
    } catch (err) {
      console.error(err)
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

const elFormsReg = document.querySelectorAll('.form-reg')
for (const form of Array.prototype.slice.call(elFormsReg)) {
  for(const input of form.querySelectorAll('input')) {
    input.oninput = function(event) {
      event.target.setCustomValidity('')
    }
  }

  form.addEventListener('submit', e => (async e => {
    e.preventDefault()
    const form = e.currentTarget
    form.classList.add('was-validated')
    try {
      const response = await fetch(form.action, {
        method: form.method,
        body: new FormData(form)
      })
      const result = await response.json()
      if (result.success) {
        window.location.href = result.success
      } else if (result.fieldsError) {
        for(const input of form.querySelectorAll('input')) {
          if (result.fieldsError.indexOf(input.name) !== -1) {
            input.parentNode.querySelector('.invalid-feedback').textContent = result.message
            input.setCustomValidity(result.message)
          }
        }
      } else {
        for(const input of form.querySelectorAll('input')) {
          input.classList.remove('is-invalid')
        }
      }
    } catch (err) {
      console.error(err)
    }
  })(e))
}



const elMainInfo = document.querySelector('#main-info')
if (elMainInfo) {
  let solsChart = initSolsChart()
  let incomePerOneIts = netSolsPerHour = netHashrate = price = 0
  const elActiveWorkers = elMainInfo.querySelector('.info-active-workers .fs-4.fw-semibold span')
  elHashrate = elMainInfo.querySelector('.info-hashrate .fs-4.fw-semibold span')
  elSol = elMainInfo.querySelector('.info-solutions .fs-4.fw-semibold span')
  elPrice = elMainInfo.querySelector('.info-price .fs-4.fw-semibold span')
  elNetwork = elMainInfo.querySelector('.info-network .fs-4.fw-semibold span')
  elSolPrice = elMainInfo.querySelector('.info-sol-price .fs-4.fw-semibold span')
  elAge = elMainInfo.querySelector('.info-age .fs-4.fw-semibold span')
  try {
    const tick = async () => {
      let res = await fetch('/api/maininfo/')
      res = await res.json()
      if (res) {
        incomePerOneIts = res.incomePerOneIts
        netSolsPerHour = res.netSolsPerHour
        netHashrate = res.netHashrate
        price = res.price
        if (elActiveWorkers) elActiveWorkers.textContent = res.total.activeWorkers
        if (elHashrate) elHashrate.textContent = res.total.hashrate
        if (elSol) elSol.textContent = res.total.solutions
        if (elPrice) elPrice.textContent = price
        if (elNetwork) elNetwork.textContent = netHashrate
        if (elSolPrice) elSolPrice.textContent = Math.round(res.curSolPrice * 100) / 100
        if (elAge) elAge.textContent = Math.floor((res.updateTime - new Date().getTime()) / 1000)

        // chart
        if (solsChart && totalSolutions != res.total.solutions) {
          updateSolsChart(solsChart)
          totalSolutions = res.total.solutions // global
        }
      }
    }
    tick().then(() => {
      if (elAge) {
        setInterval(() => {
          elAge.textContent = parseInt(elAge.textContent) - 1
        }, 1000)
      }
    })
    setInterval(tick, 60000)
  } catch (err) {
    console.error(err)
  }

  const formProfit = document.querySelector('#profitCalculator')
  const profitTable = document.querySelector('#profitCalcTable')
  if (formProfit && profitTable) {
    const profitTableCollapse = new coreui.Collapse('#profitCalcTable', {
      toggle: false
    })

    
    formProfit.addEventListener('submit', e => {
      e.preventDefault()
      const hr = parseInt(formProfit.querySelector('input[id="profitCalcHashrate"]').value)
      const comms = parseFloat(formProfit.querySelector('input[id="profitCalcComs"]').value) / 100
      const powerConsume = parseFloat(formProfit.querySelector('input[id="profitCalcPower"]').value)
      const powerCost = parseFloat(formProfit.querySelector('input[id="profitCalcPowerCost"]').value)
      let perDay = hr * incomePerOneIts
      let perSols = 24 * hr * netSolsPerHour / netHashrate

      let html = ''
      const items = [['Day', 1], ['Week', 7], ['Month', 31]]
      items.forEach(i => {
        const cost = i[1] * perDay * comms + i[1] * 24 * powerConsume / 1000 * powerCost
        html +=  `<tr>`
          + `<td>${i[0]}</td>`
          + `<td>${Math.round(i[1] * perSols * 100) / 100}</td>`
          + `<td>${Math.round(i[1] * perDay / price)}</td>`
          + `<td>${Math.round(i[1] * perDay * 100) / 100}$</td>`
          + `<td>-${Math.round(cost * 100) / 100}$</td>`
          + `<td>${Math.round((i[1] * perDay - cost) * 100) / 100}$</td>`
          + `<tr>`
      })
      profitTable.querySelector('tbody').innerHTML = html
      profitTableCollapse.show()
    })
  }
}

const elTableMiners = document.querySelector('#table-miners')
if (elTableMiners) {
  const countCols = elTableMiners.querySelector('thead tr').childElementCount
  const tbody = elTableMiners.querySelector('tbody')
  try {
    const tick = async () => {
      let res = await fetch('/api/miners/')
      res = await res.json()
      let html = ''
      for (const item of res) {
        const tr = document.createElement('tr')
        tr.classList.add('align-middle')
        html += `<tr>`    
          + `<td>${item.miner}</td>`
          + `<td>${item.countWorker}</td>`
          + `<td class="${item.countInactive || item.isEmpty ? 'text-bg-warning' : ''}">${item.its} It/s</td>`
          + `<td>${item.sol}</td>`

        if (countCols > 4) {
          html += `<td class="${item.countInactive ? 'text-bg-danger' : ''}">${item.countInactive}</td>`
        }
        html += `</tr>`
      }
      tbody.innerHTML = html
    }
    tick()
    setInterval(tick, 60000)
  } catch (err) {
    console.error(err)
  }
}


const elPanelWorkers = document.querySelector('#table-panel-workers tbody')
if (elPanelWorkers) {
  try {
    const tick = async () => {
      let res = await fetch('/api/receive/')
      res = await res.json()
      let html = ''
      for (const item of res) {
        html += `<tr class="align-middle">`
          + `<td>${item.alias}</td>`
          + `<td>${item.version.versionString}</td>`
          + `<td class="${!item.isActive ? 'text-bg-danger' : item.currentIts == 0 ? 'text-bg-warning' : ''}">${item.currentIts} It/s</td>`
          + `<td>${item.solutionsFound}</td>`
          + `<td>${item.lastActive}</td>`
          + `<td><span class="badge me-1 ${item.isActive ? 'bg-success' : 'bg-danger'}">${item.isActive.toString()}</span></td>`
          + `<tr>`
      }
      elPanelWorkers.innerHTML = html
    }
    tick()
    setInterval(tick, 60000)
  } catch (err) {
    console.error(err)
  }
}
//# sourceMappingURL=main.js.map

