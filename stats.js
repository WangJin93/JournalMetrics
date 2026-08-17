document.addEventListener('DOMContentLoaded', () => {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const noData = document.getElementById('no-data');
  const backBtn = document.getElementById('back-btn');
  const timestampEl = document.getElementById('stats-timestamp');
  
  backBtn.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });
  
  chrome.storage.local.get('statsData', (result) => {
    loading.style.display = 'none';
    
    if (!result.statsData) {
      noData.style.display = 'block';
      return;
    }
    
    const data = result.statsData;
    
    if (data.timestamp) {
      const date = new Date(data.timestamp);
      const dateStr = date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      timestampEl.textContent = `Generated at: ${dateStr}`;
    }
    
    content.style.display = 'block';
    renderStats(data);
  });
});

function renderStats(data) {
  document.getElementById('total-count').textContent = data.totalCount;
  document.getElementById('sci-count').textContent = data.sciCount;
  document.getElementById('avg-if').textContent = data.avgIF.toFixed(1);
  document.getElementById('median-if').textContent = data.medianIF.toFixed(1);
  
  renderDistribution('jcr-distribution', data.jcrDistribution, 'JCR', ['Q1', 'Q2', 'Q3', 'Q4'], {
    'Q1': '#4CAF50', 'Q2': '#2196F3', 'Q3': '#FF9800', 'Q4': '#F44336'
  });
  
  renderDistribution('cas-distribution', data.casDistribution, 'CAS', ['B1', 'B2', 'B3', 'B4'], {
    'B1': '#E91E63', 'B2': '#9C27B0', 'B3': '#673AB7', 'B4': '#3F51B5'
  });
  
  renderYearDistribution('year-distribution', data.yearDistribution);
  
  renderIFDistribution('if-distribution', data.ifDistribution);
  
  renderDistribution('oa-distribution', data.oaDistribution, 'OA', ['OA', 'Non-OA'], {
    'OA': '#4CAF50', 'Non-OA': '#9E9E9E'
  });
  
  renderTopJournals('top-journals', data.topJournals);
}

function renderDistribution(containerId, distribution, prefix, keys, colors) {
  const container = document.getElementById(containerId);
  let maxCount = 0;
  
  keys.forEach(key => {
    if (distribution[key] > maxCount) {
      maxCount = distribution[key];
    }
  });
  
  keys.forEach(key => {
    const count = distribution[key] || 0;
    const percentage = maxCount > 0 ? (count / maxCount * 100) : 0;
    
    const barDiv = document.createElement('div');
    barDiv.className = 'distribution-bar';
    barDiv.innerHTML = `
      <span class="label" style="color: ${colors[key] || '#333'}">${key}</span>
      <div class="bar-container">
        <div class="bar" style="width: ${percentage}%; background-color: ${colors[key] || '#1a73e8'}"></div>
      </div>
      <span class="count">${count}</span>
    `;
    container.appendChild(barDiv);
  });
}

function renderYearDistribution(containerId, distribution) {
  const container = document.getElementById(containerId);
  const years = Object.keys(distribution).sort((a, b) => parseInt(b) - parseInt(a));
  
  if (years.length === 0) {
    container.innerHTML = '<p style="color: #999;">No year data available</p>';
    return;
  }
  
  let maxCount = 0;
  years.forEach(year => {
    if (distribution[year] > maxCount) {
      maxCount = distribution[year];
    }
  });
  
  years.forEach(year => {
    const count = distribution[year] || 0;
    const percentage = maxCount > 0 ? (count / maxCount * 100) : 0;
    
    const barDiv = document.createElement('div');
    barDiv.className = 'distribution-bar';
    barDiv.innerHTML = `
      <span class="label">${year}</span>
      <div class="bar-container">
        <div class="bar" style="width: ${percentage}%"></div>
      </div>
      <span class="count">${count}</span>
    `;
    container.appendChild(barDiv);
  });
}

function renderIFDistribution(containerId, distribution) {
  const container = document.getElementById(containerId);
  const ranges = [
    { label: '< 1', min: -Infinity, max: 1 },
    { label: '1-3', min: 1, max: 3 },
    { label: '3-5', min: 3, max: 5 },
    { label: '5-10', min: 5, max: 10 },
    { label: '10-20', min: 10, max: 20 },
    { label: '>= 20', min: 20, max: Infinity }
  ];
  
  let maxCount = 0;
  ranges.forEach(range => {
    if (distribution[range.label] > maxCount) {
      maxCount = distribution[range.label];
    }
  });
  
  ranges.forEach(range => {
    const count = distribution[range.label] || 0;
    const percentage = maxCount > 0 ? (count / maxCount * 100) : 0;
    
    const barDiv = document.createElement('div');
    barDiv.className = 'distribution-bar';
    barDiv.innerHTML = `
      <span class="label">${range.label}</span>
      <div class="bar-container">
        <div class="bar" style="width: ${percentage}%"></div>
      </div>
      <span class="count">${count}</span>
    `;
    container.appendChild(barDiv);
  });
}

function renderTopJournals(containerId, journals) {
  const container = document.getElementById(containerId);
  
  journals.forEach((journal, index) => {
    const row = document.createElement('tr');
    const websiteLink = journal.website ? `<a href="${journal.website}" target="_blank" rel="noopener">🔗</a>` : '-';
    row.innerHTML = `
      <td class="rank">${index + 1}</td>
      <td>${journal.name}</td>
      <td>${journal.count}</td>
      <td>${journal.avgIF.toFixed(1)}</td>
      <td><span class="${journal.jcr.toLowerCase()}">${journal.jcr || '-'}</span></td>
      <td><span class="${journal.cas.toLowerCase()}">${journal.cas || '-'}</span></td>
      <td>${journal.avgSelfCitation ? (journal.avgSelfCitation * 100).toFixed(3) + '%' : '-'}</td>
      <td>${journal.oa || '-'}</td>
      <td>${journal.avgAPC ? '$' + journal.avgAPC : '-'}</td>
      <td>${journal.avgAnnualArticles || '-'}</td>
      <td>${journal.publisher || '-'}</td>
      <td>${journal.country || '-'}</td>
      <td>${websiteLink}</td>
    `;
    container.appendChild(row);
  });
}