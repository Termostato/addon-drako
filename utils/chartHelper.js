const { Chart } = require('chart.js');
const { createCanvas } = require('canvas');

async function generateMetricChart(data, metric, period) {
    const width = 1200;
    const height = 800;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const configuration = {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: metric === 'all' ? data.datasets.map(dataset => ({
                ...dataset,
                fill: true,
                tension: 0.4,
                backgroundColor: `${dataset.borderColor}15`,
                borderWidth: 3,
                pointRadius: 4,
                pointHoverRadius: 6
            })) : [{
                label: getMetricLabel(metric),
                data: data.values,
                borderColor: getMetricColor(metric),
                backgroundColor: `${getMetricColor(metric)}33`,
                fill: true,
                tension: 0.4,
                borderWidth: 3,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: false,
            layout: {
                padding: {
                    top: 20,
                    right: 20,
                    bottom: 20,
                    left: 20
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: '#ffffff15',
                        lineWidth: 1
                    },
                    ticks: {
                        color: '#ffffff',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        padding: 10
                    }
                },
                x: {
                    grid: {
                        color: '#ffffff15',
                        lineWidth: 1
                    },
                    ticks: {
                        color: '#ffffff',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        padding: 10
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                title: {
                    display: true,
                    text: `${getMetricLabel(metric)} - ${getPeriodLabel(period)}`,
                    color: '#ffffff',
                    font: {
                        size: 20,
                        weight: 'bold'
                    },
                    padding: {
                        top: 20,
                        bottom: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    titleFont: {
                        size: 16,
                        weight: 'bold'
                    },
                    bodyFont: {
                        size: 14
                    },
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true
                }
            }
        },
        plugins: [{
            id: 'customCanvasBackgroundColor',
            beforeDraw: (chart) => {
                const ctx = chart.canvas.getContext('2d');
                ctx.save();
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = '#101010';
                ctx.fillRect(0, 0, chart.width, chart.height);
                ctx.restore();
            }
        }]
    };

    const chart = new Chart(ctx, configuration);
    const buffer = canvas.toBuffer('image/png');
    chart.destroy();
    
    return buffer;
}

function getMetricLabel(metric) {
    const labels = {
        active: 'Horas Activo',
        inactive: 'Horas Inactivo',
        messages: 'Mensajes',
        voice: 'Horas en Voice',
        duty: 'Horas en Servicio',
        points: 'Puntos',
        all: 'Todas las Metricas'
    };
    return labels[metric] || metric;
}

function getPeriodLabel(period) {
    const labels = {
        '4d': 'Ultimos 4 dias',
        '7d': 'Ultimos 7 dias',
        '15d': 'Ultimos 15 dias',
        '30d': 'Ultimos 30 dias',
        'all': 'Siempre'
    };
    return labels[period] || period;
}

function getMetricColor(metric) {
    const colors = {
        points: '#FFD700',    // Gold
        messages: '#5865F2',  // Discord Blue
        voice: '#43B581',     // Green
        duty: '#FAA61A',      // Orange
        active: '#43B581',    // Green
        inactive: '#F04747'   // Red
    };
    return colors[metric] || '#5865F2';
}

module.exports = {
    generateMetricChart
}; 