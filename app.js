/**
 * 🔥 CalefacciónApp v3
 * - Precios PVPC correctos (nunca negativos)
 * - Auto-actualización a las 20:30 con precios de mañana
 * - PWA para instalar en el móvil
 */

class CalefaccionApp {
  constructor() {
    this.radiadores = [];
    this.precioKwh = 0.15;
    this.autoPrice = true;
    this.chartConsumo = null;
    this.chartPrices = null;

    this.selectedDate = new Date();
    this.currentView = 'dia';

    // Cache: { 'YYYY-MM-DD': { prices: [{hour, price}], source: 'pvpc'|'simulado' } }
    this.priceCache = {};
    this.lastSchedule = null;

    this.init();
  }

  // ===========================
  //  INIT
  // ===========================
  async init() {
    this.loadFromStorage();
    this.bindEvents();
    this.startClock();
    this.registerServiceWorker();
    this.render();

    // Decidir qué día mostrar por defecto
    await this.autoSelectDate();
    this.updateAll();
    this.scheduleAutoUpdate();
  }

  /**
   * Si es después de las 20:30, mostramos mañana por defecto
   * (los precios de mañana ya están publicados).
   */
  async autoSelectDate() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    if (hour > 20 || (hour === 20 && minute >= 30)) {
      // Intentar cargar mañana
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      this.selectedDate = tomorrow;
    }

    await this.loadPricesForDate(this.selectedDate);
  }

  // ===========================
  //  PWA
  // ===========================
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js')
        .then(reg => console.log('SW registrado:', reg.scope))
        .catch(err => console.warn('SW no registrado:', err));
    }
  }

  // ===========================
  //  AUTO-UPDATE a las 20:30
  // ===========================
  scheduleAutoUpdate() {
    const checkAndUpdate = async () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowKey = this.formatDate(tomorrow);

      // Si no tenemos datos de mañana y es después de las 20:15, intentar
      if (!this.priceCache[tomorrowKey] || this.priceCache[tomorrowKey].source === 'simulado') {
        console.log('Auto-update: buscando precios de mañana...');
        await this.loadPricesForDate(tomorrow);

        const cached = this.priceCache[tomorrowKey];
        if (cached && cached.source === 'pvpc') {
          // Tenemos precios reales de mañana, cambiar a ese día
          this.selectedDate = tomorrow;
          this.onPricesLoaded(tomorrowKey);
          this.updateDateDisplay();
          this.showAutoUpdateBanner();
        }
      }
    };

    // Calcular milisegundos hasta las 20:30
    const now = new Date();
    const target = new Date(now);
    target.setHours(20, 30, 0, 0);
    if (now >= target) {
      target.setDate(target.getDate() + 1);
    }
    const msUntil = target - now;

    // Programar para las 20:30
    setTimeout(() => {
      checkAndUpdate();
      // Después repetir cada 24h
      setInterval(checkAndUpdate, 24 * 60 * 60 * 1000);
    }, msUntil);

    // También comprobar ahora por si ya es después de las 20:30
    if (now.getHours() > 20 || (now.getHours() === 20 && now.getMinutes() >= 30)) {
      checkAndUpdate();
    }

    console.log(`Auto-update programado para las 20:30 (en ${Math.round(msUntil / 60000)} min)`);
  }

  showAutoUpdateBanner() {
    const container = document.getElementById('auto-update-banner');
    if (container) {
      container.innerHTML = `
        <div class="power-alert alert-success" style="margin-bottom:16px">
          <span class="alert-icon">🔄</span>
          <span>Precios de <strong>mañana</strong> actualizados automáticamente a las 20:30.</span>
        </div>`;
      setTimeout(() => { container.innerHTML = ''; }, 10000);
    }
  }

  // ===========================
  //  STORAGE
  // ===========================
  saveToStorage() {
    const data = {
      radiadores: this.radiadores,
      potenciaContratada: this.getPotenciaContratada(),
      precioPotencia: this.getPrecioPotencia(),
      autoPrice: this.autoPrice,
      precioManual: parseFloat(document.getElementById('precio-manual').value) || 0.15,
    };
    localStorage.setItem('calefaccion_config', JSON.stringify(data));
  }

  loadFromStorage() {
    const saved = localStorage.getItem('calefaccion_config');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        this.radiadores = data.radiadores || [];
        this.autoPrice = data.autoPrice !== undefined ? data.autoPrice : true;
        setTimeout(() => {
          if (data.potenciaContratada) document.getElementById('potencia-contratada').value = data.potenciaContratada;
          if (data.precioPotencia) document.getElementById('precio-potencia').value = data.precioPotencia;
          if (data.precioManual) document.getElementById('precio-manual').value = data.precioManual;
          document.getElementById('auto-price-toggle').checked = this.autoPrice;
          this.toggleManualPrice();
        }, 0);
      } catch (e) {
        this.setDefaults();
      }
    } else {
      this.setDefaults();
    }
  }

  setDefaults() {
    this.radiadores = [
      { id: this.uid(), nombre: 'Salón', potencia: 1500, horas: 4 },
      { id: this.uid(), nombre: 'Habitación', potencia: 1000, horas: 2 },
    ];
  }

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ===========================
  //  EVENTS
  // ===========================
  bindEvents() {
    document.getElementById('potencia-contratada').addEventListener('input', () => this.onConfigChange());
    document.getElementById('precio-potencia').addEventListener('input', () => this.onConfigChange());
    document.getElementById('auto-price-toggle').addEventListener('change', (e) => {
      this.autoPrice = e.target.checked;
      this.toggleManualPrice();
      if (!this.autoPrice) {
        this.precioKwh = parseFloat(document.getElementById('precio-manual').value) || 0.15;
      }
      this.updateAll();
      this.saveToStorage();
    });
    document.getElementById('precio-manual').addEventListener('input', () => {
      if (!this.autoPrice) {
        this.precioKwh = parseFloat(document.getElementById('precio-manual').value) || 0.15;
        this.updateAll();
        this.saveToStorage();
      }
    });
  }

  toggleManualPrice() {
    document.getElementById('manual-price-group').style.display = this.autoPrice ? 'none' : 'block';
  }

  onConfigChange() { this.updateAll(); this.saveToStorage(); }

  // ===========================
  //  PRECIO PVPC — Fuentes de datos
  // ===========================
  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async loadPricesForDate(date) {
    const key = this.formatDate(date);
    this.updateDateDisplay();

    // Check cache (solo si es fuente real)
    if (this.priceCache[key] && this.priceCache[key].source === 'pvpc') {
      this.onPricesLoaded(key);
      return;
    }

    this.showPriceLoading();

    try {
      const result = await this.fetchPVPCPrices(date);
      this.priceCache[key] = result;
      this.onPricesLoaded(key);
    } catch (e) {
      console.warn('Error fetching prices:', e);
      // Fallback simulado
      const simulated = this.generateSimulatedPrices(date);
      this.priceCache[key] = { prices: simulated, source: 'simulado' };
      this.onPricesLoaded(key);
    }
  }

  /**
   * Obtener precios PVPC (Precio Voluntario al Pequeño Consumidor).
   * Este es el precio FINAL que paga el consumidor, incluyendo:
   * - Coste de la energía (mercado diario + futuros)
   * - Peajes de transporte y distribución
   * - Cargos del sistema
   *
   * NUNCA puede ser negativo (a diferencia del precio spot del mercado mayorista).
   *
   * Fuente única y oficial: apidatos.ree.es (filtrando SOLO la serie PVPC)
   */
  async fetchPVPCPrices(date) {
    const dateStr = this.formatDate(date);

    // ============================================
    // FUENTE OFICIAL: apidatos.ree.es — Red Eléctrica
    // IMPORTANTE: Este endpoint devuelve VARIAS series.
    // Buscaremos SÓLO la serie cuyo título contenga "PVPC".
    // ============================================
    try {
      const startDate = `${dateStr}T00:00`;
      const endDate = `${dateStr}T23:59`;
      const url = `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${startDate}&end_date=${endDate}&time_trunc=hour`;

      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const prices = this.parseREEPrices(data);
        if (prices.length > 0) {
          return { prices, source: 'pvpc' };
        }
      }
    } catch (e) {
      console.warn('apidatos.ree.es no disponible:', e.message);
    }

    // ============================================
    // FALLBACK: Precios simulados con patrón PVPC realista
    // ============================================
    console.warn(`Usando precios PVPC simulados para ${dateStr}`);
    return { prices: this.generateSimulatedPrices(date), source: 'simulado' };
  }

  /**
   * Parsear respuesta de apidatos.ree.es
   *
   * CLAVE: El endpoint devuelve varias series en `included[]`.
   * Debemos buscar SÓLO la serie cuyo título contenga "PVPC".
   *
   * Series típicas:
   *   - "Precio mercado spot España"         → precio mayorista, PUEDE SER NEGATIVO ❌
   *   - "Precio mercado spot Portugal"        → no nos interesa ❌
   *   - "Precio PVPC peaje por defecto 2.0TD" → precio al consumidor ✅
   *   - Otras variantes con "PVPC" en el nombre → precio al consumidor ✅
   *
   * Los precios vienen en €/MWh → convertimos a €/kWh
   */
  parseREEPrices(data) {
    if (!data || !data.included || !Array.isArray(data.included)) return [];

    // Buscar la serie PVPC (contiene "PVPC" en el título)
    const pvpcSeries = data.included.find(series =>
      series.attributes &&
      series.attributes.title &&
      series.attributes.title.toUpperCase().includes('PVPC')
    );

    if (!pvpcSeries || !pvpcSeries.attributes || !pvpcSeries.attributes.values) {
      console.warn('No se encontró la serie PVPC en la respuesta de REE');
      console.warn('Series disponibles:', data.included.map(s =>
        s.attributes ? s.attributes.title : 'sin título'
      ));
      return []; // NO usar series que no sean PVPC
    }

    const prices = [];
    pvpcSeries.attributes.values.forEach(v => {
      if (v.value !== null && v.value !== undefined) {
        const dt = new Date(v.datetime);
        const priceKwh = v.value / 1000;
        prices.push({
          hour: dt.getHours(),
          price: Math.max(0.001, priceKwh), // PVPC nunca negativo
        });
      }
    });

    return prices.sort((a, b) => a.hour - b.hour);
  }

  /**
   * Precios PVPC simulados con patrón realista español.
   * Incluye peajes, cargos y coste energía.
   * Rango típico: 0.08 - 0.25 €/kWh (80-250 €/MWh)
   */
  generateSimulatedPrices(date) {
    // Patrón PVPC realista: valle nocturno, pico mañana y pico tarde
    // Estos valores incluyen peajes y cargos (~0.05 €/kWh base)
    const pattern = [
      0.085, 0.075, 0.068, 0.065, 0.063, 0.067, 0.078, 0.105,  // 00-07 (valle)
      0.130, 0.155, 0.175, 0.180, 0.178, 0.165, 0.145, 0.135,  // 08-15 (llano/punta)
      0.140, 0.160, 0.190, 0.205, 0.200, 0.180, 0.140, 0.105   // 16-23 (punta/valle)
    ];

    // Variación determinista basada en la fecha
    const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    return pattern.map((base, h) => {
      const noise = Math.sin(seed * (h + 1) * 0.7) * 0.015;
      return {
        hour: h,
        price: Math.max(0.04, base + noise) // mínimo ~40 €/MWh (peajes)
      };
    });
  }

  // ===========================
  //  MONTHLY PRICES
  // ===========================
  async loadMonthlyPrices(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const dailyAverages = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dayDate = new Date(year, month, d);
      if (dayDate > today) break;

      const key = this.formatDate(dayDate);
      let prices;
      if (this.priceCache[key]) {
        prices = this.priceCache[key].prices;
      } else {
        prices = this.generateSimulatedPrices(dayDate);
        this.priceCache[key] = { prices, source: 'simulado' };
      }
      const avg = prices.reduce((s, p) => s + p.price, 0) / prices.length;
      dailyAverages.push({ day: d, price: avg });
    }

    return dailyAverages;
  }

  // ===========================
  //  PRICES LOADED
  // ===========================
  onPricesLoaded(dateKey) {
    const cached = this.priceCache[dateKey];
    if (!cached) return;
    const prices = cached.prices;

    if (this.autoPrice) {
      this.precioKwh = prices.reduce((s, p) => s + p.price, 0) / prices.length;
    }

    // Mostrar indicador de fuente
    this.updateSourceIndicator(cached.source);
    this.updatePriceBadge();
    this.renderPriceChart(prices);
    this.updatePriceStats(prices);
    this.updateAll();
  }

  updateSourceIndicator(source) {
    const el = document.getElementById('data-source');
    if (el) {
      if (source === 'pvpc') {
        el.innerHTML = '<span style="color:var(--accent-green)">● Datos PVPC reales</span>';
      } else {
        el.innerHTML = '<span style="color:var(--accent-amber)">● Datos PVPC estimados</span>';
      }
    }
  }

  showPriceLoading() {
    const container = document.getElementById('price-chart-container');
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Cargando precios PVPC...</p>
      </div>`;
  }

  // ===========================
  //  DATE NAVIGATION
  // ===========================
  changeDate(delta) {
    if (this.currentView === 'dia') {
      this.selectedDate.setDate(this.selectedDate.getDate() + delta);
    } else {
      this.selectedDate.setMonth(this.selectedDate.getMonth() + delta);
    }
    this.lastSchedule = null;
    document.getElementById('optimization-section').style.display = 'none';

    if (this.currentView === 'dia') {
      this.loadPricesForDate(this.selectedDate);
    } else {
      this.renderMonthView();
    }
    this.updateDateDisplay();
  }

  updateDateDisplay() {
    const label = document.getElementById('date-label');
    const sub = document.getElementById('date-sub-label');
    const today = this.formatDate(new Date());
    const sel = this.formatDate(this.selectedDate);

    if (this.currentView === 'dia') {
      label.textContent = this.selectedDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      if (sel === today) sub.textContent = 'Hoy';
      else {
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        if (sel === this.formatDate(tomorrow)) sub.textContent = 'Mañana';
        else if (sel === this.formatDate(yesterday)) sub.textContent = 'Ayer';
        else sub.textContent = this.selectedDate.getFullYear().toString();
      }
    } else {
      label.textContent = this.selectedDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      sub.textContent = 'Precio medio diario';
    }

    // Limitar: máximo mañana
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('btn-next').disabled =
      this.currentView === 'dia' && this.formatDate(this.selectedDate) >= this.formatDate(tomorrow);
  }

  setView(view) {
    this.currentView = view;
    document.getElementById('tab-dia').classList.toggle('active', view === 'dia');
    document.getElementById('tab-mes').classList.toggle('active', view === 'mes');
    if (view === 'dia') this.loadPricesForDate(this.selectedDate);
    else this.renderMonthView();
    this.updateDateDisplay();
  }

  async renderMonthView() {
    this.showPriceLoading();
    const dailyAvgs = await this.loadMonthlyPrices(this.selectedDate);
    const container = document.getElementById('price-chart-container');
    container.innerHTML = '<canvas id="chart-prices"></canvas>';
    document.getElementById('price-chart-title').textContent = 'Precio medio diario (PVPC)';

    const labels = dailyAvgs.map(d => `${d.day}`);
    const data = dailyAvgs.map(d => d.price * 1000);
    const avg = data.reduce((s, v) => s + v, 0) / data.length;
    const colors = data.map(v => v < avg * 0.85 ? 'rgba(46,213,115,0.7)' : v > avg * 1.15 ? 'rgba(255,71,87,0.7)' : 'rgba(247,147,30,0.7)');

    if (this.chartPrices) { this.chartPrices.destroy(); this.chartPrices = null; }
    this.chartPrices = new Chart(document.getElementById('chart-prices'), {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
      options: this.getChartOpts('€/MWh')
    });

    const pkwh = dailyAvgs.map(d => d.price);
    document.getElementById('stat-min').textContent = `${(Math.min(...pkwh) * 1000).toFixed(1)} €/MWh`;
    document.getElementById('stat-avg').textContent = `${(pkwh.reduce((s, v) => s + v, 0) / pkwh.length * 1000).toFixed(1)} €/MWh`;
    document.getElementById('stat-max').textContent = `${(Math.max(...pkwh) * 1000).toFixed(1)} €/MWh`;
  }

  // ===========================
  //  PRICE CHART (Daily)
  // ===========================
  renderPriceChart(prices) {
    const container = document.getElementById('price-chart-container');
    container.innerHTML = '<canvas id="chart-prices"></canvas>';
    document.getElementById('price-chart-title').textContent = 'Precio PVPC por hora';

    const labels = prices.map(p => `${String(p.hour).padStart(2, '0')}:00`);
    const data = prices.map(p => p.price * 1000); // €/MWh para mostrar
    const avg = data.reduce((s, v) => s + v, 0) / data.length;

    const colors = data.map(v =>
      v < avg * 0.85 ? 'rgba(46,213,115,0.8)' :
      v > avg * 1.15 ? 'rgba(255,71,87,0.8)' :
      'rgba(247,147,30,0.7)'
    );

    const now = new Date();
    const isToday = this.formatDate(this.selectedDate) === this.formatDate(now);
    const currentHour = now.getHours();
    const borderColors = prices.map(p => isToday && p.hour === currentHour ? '#ffffff' : 'transparent');
    const borderWidths = prices.map(p => isToday && p.hour === currentHour ? 2 : 0);

    if (this.chartPrices) { this.chartPrices.destroy(); this.chartPrices = null; }
    this.chartPrices = new Chart(document.getElementById('chart-prices'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data, backgroundColor: colors,
          borderColor: borderColors, borderWidth: borderWidths,
          borderRadius: 4, borderSkipped: false,
        }]
      },
      options: this.getChartOpts('€/MWh')
    });
  }

  getChartOpts(unit) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,15,26,0.95)', titleColor: '#f0f0f5', bodyColor: '#9090a8',
          borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, cornerRadius: 10, padding: 12,
          bodyFont: { family: 'JetBrains Mono' },
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toFixed(2)} ${unit} (${(ctx.parsed.y / 1000).toFixed(4)} €/kWh)`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#5a5a72', font: { size: 10, family: 'JetBrains Mono' } } },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#5a5a72', font: { size: 10, family: 'JetBrains Mono' }, callback: v => v.toFixed(0) },
          title: { display: true, text: unit, color: '#5a5a72', font: { size: 10 } },
          min: 0 // PVPC nunca negativo
        }
      }
    };
  }

  updatePriceStats(prices) {
    const vals = prices.map(p => p.price);
    document.getElementById('stat-min').textContent = `${(Math.min(...vals) * 1000).toFixed(1)} €/MWh`;
    document.getElementById('stat-avg').textContent = `${(vals.reduce((s, v) => s + v, 0) / vals.length * 1000).toFixed(1)} €/MWh`;
    document.getElementById('stat-max').textContent = `${(Math.max(...vals) * 1000).toFixed(1)} €/MWh`;
  }

  updatePriceBadge() {
    const badge = document.getElementById('price-badge');
    const display = document.getElementById('price-display');
    display.textContent = `Media: ${(this.precioKwh * 1000).toFixed(1)} €/MWh`;
    badge.classList.remove('price-high', 'price-low');
    if (this.precioKwh > 0.20) badge.classList.add('price-high');
    else if (this.precioKwh < 0.10) badge.classList.add('price-low');
  }

  // ===========================
  //  CLOCK
  // ===========================
  startClock() {
    const tick = () => {
      document.getElementById('clock-display').textContent =
        new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick(); setInterval(tick, 1000);
  }

  // ===========================
  //  GETTERS
  // ===========================
  getPotenciaContratada() { return parseFloat(document.getElementById('potencia-contratada').value) || 4.6; }
  getPrecioPotencia() { return parseFloat(document.getElementById('precio-potencia').value) || 30.0; }

  // ===========================
  //  RADIADOR CRUD
  // ===========================
  addRadiador() {
    this.radiadores.push({ id: this.uid(), nombre: `Radiador ${this.radiadores.length + 1}`, potencia: 1000, horas: 3 });
    this.render(); this.updateAll(); this.saveToStorage();
  }

  removeRadiador(id) {
    this.radiadores = this.radiadores.filter(r => r.id !== id);
    this.render(); this.updateAll(); this.saveToStorage();
  }

  updateRadiador(id, field, value) {
    const rad = this.radiadores.find(r => r.id === id);
    if (!rad) return;
    if (field === 'nombre') rad.nombre = value;
    else if (field === 'potencia') rad.potencia = Math.max(0, parseInt(value) || 0);
    else if (field === 'horas') rad.horas = Math.max(0, Math.min(24, parseFloat(value) || 0));
    this.updateAll(); this.saveToStorage();
  }

  // ===========================
  //  RENDER RADIADORES
  // ===========================
  render() {
    const grid = document.getElementById('radiadores-grid');
    grid.innerHTML = '';

    this.radiadores.forEach(rad => {
      const card = document.createElement('div');
      card.className = 'radiador-card';
      card.innerHTML = `
        <div class="card-header">
          <input type="text" value="${this.esc(rad.nombre)}" id="rad-n-${rad.id}"
            onchange="app.updateRadiador('${rad.id}', 'nombre', this.value)" placeholder="Nombre">
          <button class="btn-delete" onclick="app.removeRadiador('${rad.id}')" title="Eliminar">✕</button>
        </div>
        <div class="radiador-field">
          <div class="field-header">
            <span class="field-label">Potencia</span>
            <span class="field-value" id="pv-${rad.id}">${rad.potencia} W</span>
          </div>
          <input type="number" class="radiador-input" value="${rad.potencia}" step="100" min="0" max="5000"
            oninput="app.updateRadiador('${rad.id}','potencia',this.value);document.getElementById('pv-${rad.id}').textContent=this.value+' W'">
        </div>
        <div class="radiador-field">
          <div class="field-header">
            <span class="field-label">🕐 Horas que quiero encenderlo</span>
            <span class="field-value" id="hv-${rad.id}">${rad.horas}h</span>
          </div>
          <input type="range" class="custom-slider" value="${rad.horas}" min="0" max="24" step="1"
            oninput="app.updateRadiador('${rad.id}','horas',this.value);document.getElementById('hv-${rad.id}').textContent=this.value+'h'">
        </div>
        <div class="card-footer">
          <div>
            <div class="cost-label">Coste medio/día</div>
            <div class="cost-preview" id="cost-${rad.id}">-- €</div>
          </div>
          <div style="text-align:right">
            <div class="cost-label">Consumo</div>
            <div class="field-value" style="font-size:0.9rem" id="kwh-${rad.id}">-- kWh</div>
          </div>
        </div>`;
      grid.appendChild(card);
    });

    document.getElementById('radiador-count').textContent = this.radiadores.length;
  }

  esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  // ===========================
  //  UPDATE ALL
  // ===========================
  updateAll() {
    const potContratada = this.getPotenciaContratada();
    let potTotal = 0, consumoDiario = 0;
    this.radiadores.forEach(r => { potTotal += r.potencia / 1000; consumoDiario += (r.potencia * r.horas) / 1000; });
    const costeMedio = consumoDiario * this.precioKwh;

    document.getElementById('val-consumo').textContent = consumoDiario.toFixed(2);
    document.getElementById('sub-consumo').textContent = `${(consumoDiario * 30).toFixed(0)} kWh/mes`;
    document.getElementById('val-coste').textContent = costeMedio.toFixed(2);
    document.getElementById('sub-coste').textContent = `Media: ${(this.precioKwh * 1000).toFixed(1)} €/MWh`;
    document.getElementById('val-potencia').textContent = potTotal.toFixed(2);
    document.getElementById('sub-potencia').textContent = `Límite: ${potContratada} kW`;
    document.getElementById('val-radiadores').textContent = this.radiadores.length;
    document.getElementById('sub-radiadores').textContent = `${this.radiadores.reduce((s, r) => s + r.horas, 0)}h totales/día`;

    const pm = document.getElementById('metric-potencia');
    pm.classList.remove('danger', 'success', 'warning');
    if (potTotal > potContratada) pm.classList.add('danger');
    else if (potTotal > potContratada * 0.8) pm.classList.add('warning');
    else pm.classList.add('success');

    this.updatePowerAlert(potTotal, potContratada);
    this.updateGauge(potTotal, potContratada);
    this.updateDonutChart();

    this.radiadores.forEach(r => {
      const elC = document.getElementById(`cost-${r.id}`);
      const elK = document.getElementById(`kwh-${r.id}`);
      if (elC) elC.textContent = `${((r.potencia * r.horas / 1000) * this.precioKwh).toFixed(2)} €`;
      if (elK) elK.textContent = `${(r.potencia * r.horas / 1000).toFixed(1)} kWh`;
    });

    const key = this.formatDate(this.selectedDate);
    document.getElementById('btn-optimize').disabled = !this.priceCache[key] || this.radiadores.length === 0;
  }

  updatePowerAlert(total, limit) {
    const c = document.getElementById('power-alert-container');
    if (total > limit) {
      c.innerHTML = `<div class="power-alert alert-danger"><span class="alert-icon">⚠️</span>
        <span>¡CUIDADO! Potencia simultánea: <strong>${total.toFixed(2)} kW</strong> — supera tus <strong>${limit} kW</strong>. El optimizador lo tendrá en cuenta.</span></div>`;
    } else {
      c.innerHTML = `<div class="power-alert alert-success"><span class="alert-icon">✅</span>
        <span>Potencia simultánea: <strong>${total.toFixed(2)} kW</strong> — ${((total / limit) * 100).toFixed(0)}% de tu potencia contratada.</span></div>`;
    }
  }

  updateGauge(total, limit) {
    const fill = document.getElementById('gauge-fill'), text = document.getElementById('gauge-value'), sub = document.getElementById('gauge-sublabel');
    const pathLen = Math.PI * 80, ratio = Math.min(total / limit, 1.3);
    fill.style.strokeDasharray = pathLen;
    fill.style.strokeDashoffset = pathLen * (1 - Math.min(ratio, 1));
    fill.style.stroke = ratio > 1 ? '#ff4757' : ratio > 0.8 ? '#f7931e' : '#2ed573';
    text.textContent = total.toFixed(1);
    sub.textContent = `de ${limit} kW`;
  }

  updateDonutChart() {
    const ctx = document.getElementById('chart-consumo');
    const labels = this.radiadores.map(r => r.nombre);
    const data = this.radiadores.map(r => (r.potencia * r.horas) / 1000);
    const palette = ['#ff6b35','#f7931e','#ffd700','#2ed573','#5b8def','#a55eea','#ff6b81','#70a1ff'];

    if (this.chartConsumo) {
      this.chartConsumo.data.labels = labels;
      this.chartConsumo.data.datasets[0].data = data;
      this.chartConsumo.data.datasets[0].backgroundColor = palette.slice(0, data.length);
      this.chartConsumo.update('none');
      return;
    }
    this.chartConsumo = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: palette.slice(0, data.length), borderWidth: 0, hoverOffset: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'right', labels: { color: '#9090a8', font: { family: 'Inter', size: 12 }, padding: 14, usePointStyle: true } },
          tooltip: { backgroundColor: 'rgba(15,15,26,0.95)', bodyFont: { family: 'JetBrains Mono' },
            callbacks: { label: ctx => ` ${ctx.parsed.toFixed(1)} kWh/día` } }
        }
      }
    });
  }

  // ===========================
  //  🧠 OPTIMIZATION ENGINE
  // ===========================
  runOptimization() {
    const key = this.formatDate(this.selectedDate);
    const cached = this.priceCache[key];
    if (!cached || cached.prices.length === 0) return;
    const prices = cached.prices;
    const potContratada = this.getPotenciaContratada();

    // Schedule: 24 slots
    const schedule = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      price: (prices.find(p => p.hour === h) || { price: this.precioKwh }).price,
      radiadores: [],
      powerUsed: 0,
      cost: 0
    }));

    // Ordenar radiadores: los más difíciles primero (más potencia × más horas)
    const rads = [...this.radiadores].filter(r => r.horas > 0)
      .sort((a, b) => (b.horas * b.potencia) - (a.horas * a.potencia));

    // Asignar cada radiador a las horas MÁS BARATAS que quepan
    rads.forEach(rad => {
      const hoursNeeded = Math.ceil(rad.horas);
      const radKw = rad.potencia / 1000;
      const available = schedule
        .filter(s => (s.powerUsed + radKw) <= potContratada)
        .sort((a, b) => a.price - b.price);
      available.slice(0, hoursNeeded).forEach(slot => {
        slot.radiadores.push(rad.id);
        slot.powerUsed += radKw;
        slot.cost += radKw * slot.price;
      });
    });

    const optimalCost = schedule.reduce((s, sl) => s + sl.cost, 0);
    const worstCost = this.calcWorstCost(prices, potContratada);
    this.lastSchedule = { schedule, optimalCost, worstCost };
    this.renderOptimization();
  }

  calcWorstCost(prices, potContratada) {
    const schedule = Array.from({ length: 24 }, (_, h) => ({
      price: (prices.find(p => p.hour === h) || { price: this.precioKwh }).price,
      powerUsed: 0, cost: 0
    }));
    const rads = [...this.radiadores].filter(r => r.horas > 0).sort((a, b) => (b.horas * b.potencia) - (a.horas * a.potencia));
    rads.forEach(rad => {
      const n = Math.ceil(rad.horas), kw = rad.potencia / 1000;
      schedule.filter(s => (s.powerUsed + kw) <= potContratada).sort((a, b) => b.price - a.price)
        .slice(0, n).forEach(s => { s.powerUsed += kw; s.cost += kw * s.price; });
    });
    return schedule.reduce((s, sl) => s + sl.cost, 0);
  }

  renderOptimization() {
    if (!this.lastSchedule) return;
    const { schedule, optimalCost, worstCost } = this.lastSchedule;
    const section = document.getElementById('optimization-section');
    section.style.display = 'block';

    const dateLabel = this.selectedDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('opt-subtitle').textContent =
      `Planificación óptima para ${dateLabel}. Cada radiador se enciende en las horas más baratas respetando tu potencia contratada.`;

    const saving = worstCost - optimalCost;
    const pct = worstCost > 0 ? ((saving / worstCost) * 100).toFixed(0) : 0;
    document.getElementById('cost-comparison').innerHTML = `
      <div class="cost-box"><h4>Sin optimizar</h4><div class="big-value red">${worstCost.toFixed(2)} €</div><div class="cost-sub">Peor caso (horas caras)</div></div>
      <div class="cost-arrow"><span class="arrow">→</span><span class="saving-badge">-${pct}%</span></div>
      <div class="cost-box"><h4>Optimizado</h4><div class="big-value green">${optimalCost.toFixed(2)} €</div><div class="cost-sub">Ahorras ${saving.toFixed(2)} €/día</div></div>`;

    this.renderScheduleGrid(schedule);

    const pp = this.getPrecioPotencia(), pc = this.getPotenciaContratada();
    document.getElementById('opt-semanal').textContent = `${(optimalCost * 7).toFixed(2)} €`;
    document.getElementById('opt-mensual').textContent = `${(optimalCost * 30).toFixed(2)} €`;
    document.getElementById('opt-anual').textContent = `${(optimalCost * 365 + pc * pp).toFixed(2)} €`;

    this.renderTips(schedule, saving);
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  renderScheduleGrid(schedule) {
    const grid = document.getElementById('schedule-grid');
    const rads = this.radiadores.filter(r => r.horas > 0);
    grid.style.gridTemplateColumns = `55px 70px ${'1fr '.repeat(rads.length)} 65px`;

    const sorted = [...schedule].sort((a, b) => a.hour - b.hour);
    const avgPrice = sorted.reduce((s, sl) => s + sl.price, 0) / sorted.length;

    let html = `<div class="sg-row">
      <div class="sg-cell sg-header-cell">Hora</div><div class="sg-cell sg-header-cell">€/MWh</div>
      ${rads.map(r => `<div class="sg-cell sg-header-cell">${this.esc(r.nombre)}</div>`).join('')}
      <div class="sg-cell sg-header-cell">Coste</div></div>`;

    sorted.forEach(slot => {
      const cls = slot.price < avgPrice * 0.85 ? 'cheap' : slot.price > avgPrice * 1.15 ? 'expensive' : 'mid';
      html += `<div class="sg-row">
        <div class="sg-cell sg-hour-cell">${String(slot.hour).padStart(2, '0')}:00</div>
        <div class="sg-cell sg-price-cell ${cls}">${(slot.price * 1000).toFixed(1)}</div>
        ${rads.map(r => {
          const on = slot.radiadores.includes(r.id);
          return `<div class="sg-cell sg-rad-cell ${on ? 'active' : 'inactive'}">${on ? '🔥' : '·'}</div>`;
        }).join('')}
        <div class="sg-cell sg-cost-cell">${slot.cost > 0 ? slot.cost.toFixed(3) + '€' : '—'}</div></div>`;
    });

    const total = sorted.reduce((s, sl) => s + sl.cost, 0);
    html += `<div class="sg-row">
      <div class="sg-cell sg-header-cell" style="font-weight:700">TOTAL</div><div class="sg-cell sg-header-cell"></div>
      ${rads.map(r => `<div class="sg-cell sg-header-cell" style="color:var(--accent-amber)">${sorted.filter(s => s.radiadores.includes(r.id)).length}h</div>`).join('')}
      <div class="sg-cell sg-header-cell" style="color:var(--accent-gold);font-weight:700">${total.toFixed(2)}€</div></div>`;

    grid.innerHTML = html;
  }

  renderTips(schedule, saving) {
    const tips = [];
    const sorted = [...schedule].sort((a, b) => a.price - b.price);
    const cheapHours = sorted.filter(s => s.radiadores.length > 0).slice(0, 3).map(s => `${String(s.hour).padStart(2, '0')}:00`);

    if (cheapHours.length > 0) tips.push({ icon: '💚', text: `Las mejores horas para encender son: <strong>${cheapHours.join(', ')}</strong>.`, saving: '' });
    if (saving > 0.01) tips.push({ icon: '💰', text: `Siguiendo este horario ahorras <strong>${saving.toFixed(2)} €/día</strong> vs el peor caso.`, saving: `${(saving * 30).toFixed(2)} €/mes` });

    const nightHours = schedule.filter(s => s.hour < 8 && s.radiadores.length > 0).length;
    const activeHours = schedule.filter(s => s.radiadores.length > 0).length;
    if (activeHours > 0 && nightHours / activeHours > 0.5) {
      tips.push({ icon: '🌙', text: `El <strong>${((nightHours / activeHours) * 100).toFixed(0)}%</strong> del consumo cae en horario nocturno (00-08h), cuando la electricidad es más barata.`, saving: '' });
    }

    if (tips.length === 0) tips.push({ icon: '✨', text: 'Tu configuración está optimizada.', saving: '' });

    document.getElementById('tips-list').innerHTML = tips.map(t => `
      <div class="tip-item"><span class="tip-icon">${t.icon}</span>
      <span>${t.text}${t.saving ? ` <span class="tip-saving">${t.saving}</span>` : ''}</span></div>`).join('');
  }

  // ===========================
  //  EXPORT / IMPORT
  // ===========================
  exportConfig() {
    const data = { radiadores: this.radiadores, potenciaContratada: this.getPotenciaContratada(), precioPotencia: this.getPrecioPotencia(), autoPrice: this.autoPrice, precioManual: parseFloat(document.getElementById('precio-manual').value) || 0.15, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `calefaccion_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  importConfig(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.radiadores) this.radiadores = data.radiadores.map(r => ({ ...r, id: r.id || this.uid() }));
        if (data.potenciaContratada) document.getElementById('potencia-contratada').value = data.potenciaContratada;
        if (data.precioPotencia) document.getElementById('precio-potencia').value = data.precioPotencia;
        if (data.precioManual) document.getElementById('precio-manual').value = data.precioManual;
        if (data.autoPrice !== undefined) { this.autoPrice = data.autoPrice; document.getElementById('auto-price-toggle').checked = this.autoPrice; this.toggleManualPrice(); }
        this.render(); this.updateAll(); this.saveToStorage();
      } catch (err) { alert('Archivo JSON inválido.'); }
    };
    reader.readAsText(file); event.target.value = '';
  }
}

const app = new CalefaccionApp();
