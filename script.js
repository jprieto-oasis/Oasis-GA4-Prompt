// Configuración Global
const CLIENT_ID = '225313536161-232hjqsm54v92f8hh45s6qh86i0407o6.apps.googleusercontent.com';
const PROPERTY_ID = '317504536';
const SCOPES = 'https://www.googleapis.com/auth/analytics.readonly';

let accessToken = null;
let tokenClient;
let charts = {}; // Store chart instances to destroy them before re-rendering

// DOM Elements
const loginOverlay = document.getElementById('login-overlay');
const dashboard = document.getElementById('dashboard');
const authBtn = document.getElementById('auth-btn');
const loginError = document.getElementById('login-error');
const userProfile = document.getElementById('user-profile');
const userAvatar = document.getElementById('user-avatar');
const logoutBtn = document.getElementById('logout-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings');
const geminiKeyInput = document.getElementById('gemini-key');
const saveKeyBtn = document.getElementById('save-key-btn');
const clearKeyBtn = document.getElementById('clear-key-btn');
const promptForm = document.getElementById('prompt-form');
const aiPrompt = document.getElementById('ai-prompt');
const promptStatus = document.getElementById('prompt-status');
const aiResultSection = document.getElementById('ai-result-section');
const closeAiChart = document.getElementById('close-ai-chart');
const aiChartTitle = document.getElementById('ai-chart-title');

// Inicializar Google Identity Services
window.onload = function () {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                accessToken = tokenResponse.access_token;
                handleLoginSuccess();
            }
        },
    });

    // Load saved Gemini Key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        geminiKeyInput.value = savedKey;
    }
};

// Autenticación
authBtn.addEventListener('click', () => {
    tokenClient.requestAccessToken();
});

logoutBtn.addEventListener('click', () => {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            accessToken = null;
            dashboard.style.display = 'none';
            userProfile.style.display = 'none';
            settingsBtn.style.display = 'none';
            loginOverlay.classList.add('active');
        });
    }
});

function handleLoginSuccess() {
    loginOverlay.classList.remove('active');
    dashboard.style.display = 'block';
    userProfile.style.display = 'flex';
    settingsBtn.style.display = 'block';
    
    // Set a placeholder avatar (Google API doesn't return user info with just analytics scope easily, so we use a generic one)
    userAvatar.src = 'https://ui-avatars.com/api/?name=User&background=6366f1&color=fff';
    
    // Load default charts
    loadDefaultCharts();
}

// Configuración de Gemini
settingsBtn.addEventListener('click', () => settingsModal.classList.add('active'));
closeSettings.addEventListener('click', () => settingsModal.classList.remove('active'));

saveKeyBtn.addEventListener('click', () => {
    const key = geminiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        settingsModal.classList.remove('active');
        alert('API Key guardada correctamente.');
    }
});

clearKeyBtn.addEventListener('click', () => {
    localStorage.removeItem('gemini_api_key');
    geminiKeyInput.value = '';
    alert('API Key eliminada.');
});

// Peticiones a GA4 API
async function fetchGA4Data(requestBody) {
    if (!accessToken) throw new Error('No hay token de acceso');

    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Error fetching GA4 data');
    }

    return await response.json();
}

// Cargar Gráficos por Defecto
async function loadDefaultCharts() {
    try {
        // Usuarios Activos últimos 7 días
        const usersData = await fetchGA4Data({
            dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'activeUsers' }]
        });
        
        // Formatear datos para Chart.js
        const labels = usersData.rows ? usersData.rows.map(row => {
            const dateStr = row.dimensionValues[0].value;
            return `${dateStr.substring(6,8)}/${dateStr.substring(4,6)}`;
        }) : [];
        const values = usersData.rows ? usersData.rows.map(row => parseInt(row.metricValues[0].value)) : [];

        renderChart('usersChart', 'line', labels, values, 'Usuarios Activos', '#6366f1');

        // Sesiones por Dispositivo
        const deviceData = await fetchGA4Data({
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'deviceCategory' }],
            metrics: [{ name: 'sessions' }]
        });

        const deviceLabels = deviceData.rows ? deviceData.rows.map(row => row.dimensionValues[0].value) : [];
        const deviceValues = deviceData.rows ? deviceData.rows.map(row => parseInt(row.metricValues[0].value)) : [];

        renderChart('deviceChart', 'doughnut', deviceLabels, deviceValues, 'Sesiones', ['#6366f1', '#10b981', '#ec4899']);

    } catch (error) {
        console.error('Error loading default charts:', error);
    }
}

// Lógica de IA con Gemini
promptForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = aiPrompt.value.trim();
    if (!prompt) return;

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        alert('Por favor, configura tu API Key de Gemini en los ajustes (icono de engranaje arriba a la derecha).');
        settingsModal.classList.add('active');
        return;
    }

    promptStatus.textContent = 'Analizando tu petición con IA...';
    aiResultSection.style.display = 'none';

    try {
        // 1. Pedir a Gemini que construya el JSON
        const aiResponse = await generateGA4RequestFromPrompt(prompt, apiKey);
        promptStatus.textContent = 'Obteniendo datos de Google Analytics...';

        // 2. Hacer la petición a GA4
        const ga4Data = await fetchGA4Data(aiResponse.ga4Request);
        promptStatus.textContent = 'Dibujando gráfico...';

        // 3. Procesar y renderizar
        processAndRenderAIChart(ga4Data, aiResponse.chartType, prompt);
        
        promptStatus.textContent = '';
        aiResultSection.style.display = 'block';

    } catch (error) {
        console.error(error);
        promptStatus.textContent = '';
        alert(`Error: ${error.message}`);
    }
});

closeAiChart.addEventListener('click', () => {
    aiResultSection.style.display = 'none';
});

async function generateGA4RequestFromPrompt(userPrompt, apiKey) {
    const systemInstruction = `
    Eres un experto en Google Analytics 4 Data API v1.
    Tu trabajo es convertir la petición del usuario en un JSON estricto.
    El JSON DEBE tener esta estructura exacta:
    {
      "ga4Request": {
         "dateRanges": [{"startDate": "YYYY-MM-DD o NdaysAgo", "endDate": "YYYY-MM-DD o today"}],
         "dimensions": [{"name": "nombre_dimension"}],
         "metrics": [{"name": "nombre_metrica"}]
      },
      "chartType": "bar" // opciones: bar, line, pie, doughnut, table
    }
    
    REGLA MUY IMPORTANTE SOBRE chartType:
    - Si el usuario pide explícitamente "una tabla" o si pide "varias columnas" o usas MÁS DE UNA dimensión, DEBES elegir obligatoriamente "table".
    - Usa "pie" o "doughnut" para porcentajes simples de una sola dimensión.
    - Usa "line" para tendencias a lo largo del tiempo (date).
    - Usa "bar" para comparaciones de una métrica entre categorías.

    Dimensiones comunes: date, country, city, deviceCategory, pagePath, sessionSourceMedium.
    Métricas comunes: activeUsers, sessions, screenPageViews, bounceRate, totalRevenue.
    Asegúrate de que los nombres de las dimensiones y métricas sean válidos en GA4.
    Solo devuelve código JSON, sin markdown, sin texto adicional.
    `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
        })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error("Gemini API Error:", errData);
        throw new Error(`Error de IA (${response.status}): ${errData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text;
    
    // Limpiar posibles backticks de markdown
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    
    try {
        return JSON.parse(textResult);
    } catch (e) {
        throw new Error('Gemini no devolvió un JSON válido. Intenta redactar la petición de otra forma.');
    }
}

function processAndRenderAIChart(ga4Data, chartType, originalPrompt) {
    if (!ga4Data.rows || ga4Data.rows.length === 0) {
        throw new Error('Analytics no devolvió datos para esta consulta.');
    }

    aiChartTitle.textContent = originalPrompt;
    
    const canvasEl = document.getElementById('aiChart');
    const tableContainer = document.getElementById('ai-table-container');

    if (chartType === 'table') {
        canvasEl.style.display = 'none';
        tableContainer.style.display = 'block';
        renderTable(ga4Data, tableContainer);
    } else {
        tableContainer.style.display = 'none';
        canvasEl.style.display = 'block';

        const labels = ga4Data.rows.map(row => {
            let label = row.dimensionValues[0].value;
            if (label.length === 8 && !isNaN(label)) {
                label = `${label.substring(6,8)}/${label.substring(4,6)}`;
            }
            return label;
        });
        
        const values = ga4Data.rows.map(row => parseFloat(row.metricValues[0].value));
        const metricName = ga4Data.metricHeaders[0].name;
        const colors = ['#6366f1', '#10b981', '#ec4899', '#f59e0b', '#8b5cf6', '#06b6d4'];

        renderChart('aiChart', chartType, labels, values, metricName, colors);
    }
}

function renderTable(ga4Data, container) {
    const dimensionHeaders = ga4Data.dimensionHeaders.map(h => h.name);
    const metricHeaders = ga4Data.metricHeaders.map(h => h.name);
    
    let tableHtml = '<table class="ai-data-table"><thead><tr>';
    
    dimensionHeaders.forEach(h => { tableHtml += `<th>${h}</th>`; });
    metricHeaders.forEach(h => { tableHtml += `<th class="number-cell">${h}</th>`; });
    tableHtml += '</tr></thead><tbody>';

    ga4Data.rows.forEach(row => {
        tableHtml += '<tr>';
        row.dimensionValues.forEach(dim => {
            let val = dim.value;
            if (val.length === 8 && !isNaN(val)) val = `${val.substring(6,8)}/${val.substring(4,6)}/${val.substring(0,4)}`;
            tableHtml += `<td>${val}</td>`;
        });
        row.metricValues.forEach(met => {
            const num = parseFloat(met.value);
            const formatted = Number.isInteger(num) ? num.toLocaleString() : num.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            tableHtml += `<td class="number-cell">${formatted}</td>`;
        });
        tableHtml += '</tr>';
    });
    
    tableHtml += '</tbody></table>';
    container.innerHTML = tableHtml;
}

// Helper para Chart.js
function renderChart(canvasId, type, labels, data, labelName, colors) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";

    const config = {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: labelName,
                data: data,
                backgroundColor: type === 'line' ? 'transparent' : colors,
                borderColor: type === 'line' ? colors : (Array.isArray(colors) ? undefined : colors),
                borderWidth: type === 'line' ? 3 : 1,
                tension: 0.4,
                fill: type === 'line' ? false : true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: type !== 'bar' && type !== 'line',
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            const val = context.raw;
                            
                            // Calculate percentage
                            const dataset = context.chart.data.datasets[context.datasetIndex];
                            const total = dataset.data.reduce((acc, curr) => acc + curr, 0);
                            const percentage = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                            
                            const formattedVal = Number.isInteger(val) ? val.toLocaleString() : val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
                            
                            return `${label}${formattedVal} (${percentage}%)`;
                        }
                    }
                }
            },
            scales: (type === 'pie' || type === 'doughnut') ? {} : {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    };

    charts[canvasId] = new Chart(ctx, config);
}
