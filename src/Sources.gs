// Fetches every source and turns each posting into one shape:
// {source, kind, key, tcKey, title, company, url, location, type, posted (ms), pay, payUsdHourly, description, replies}
const UA = 'Mozilla/5.0 (personal job digest)';

function collectJobs_() {
  const jobs = [];
  const stats = [];
  chunk_(SOURCES, 10).forEach(wave => {
    fetchMany_(wave.map(s => ({ url: s.url, headers: { 'User-Agent': UA }, muteHttpExceptions: true })))
      .forEach((res, i) => {
        const src = wave[i];
        const stat = { name: src.name, code: res.code, found: 0, error: '' };
        if (res.code === 200) {
          try {
            PARSERS[src.kind](res.text, src).forEach(j => { jobs.push(finish_(j, src)); stat.found++; });
          } catch (e) {
            stat.error = 'parse: ' + e.message;
          }
        } else {
          stat.error = res.error || 'HTTP ' + res.code;
        }
        stats.push(stat);
      });
  });
  return { jobs, stats };
}

// fetchAll, except one dead host (timeout, DNS) can't sink the whole wave.
function fetchMany_(requests) {
  let responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (e) {
    responses = requests.map(r => {
      try { return UrlFetchApp.fetch(r.url, r); } catch (err) { return { error: String(err.message || err) }; }
    });
  }
  return responses.map(r => r.error
    ? { code: 0, text: '', error: r.error }
    : { code: r.getResponseCode(), text: r.getContentText() });
}

const PARSERS = {
  himalayas(text) {
    return (JSON.parse(text).jobs || []).map(j => ({
      title: j.title,
      company: j.companyName,
      url: j.guid || j.applicationLink,
      location: (j.locationRestrictions || []).map(x => (x && x.name) || x).join(', ') || 'Worldwide',
      type: j.employmentType,
      posted: j.pubDate ? j.pubDate * 1000 : null,
      pay: payText_(j.minSalary, j.maxSalary, j.currency, j.salaryPeriod),
      payUsdHourly: usdHourly_(j.maxSalary || j.minSalary, j.currency, j.salaryPeriod),
      description: plain_(j.description || j.excerpt),
    }));
  },

  // We Work Remotely: "Company: Title" items with region and type tags.
  rss(text) {
    return rssItems_(text).map(it => {
      const cut = it.title.indexOf(': ');
      return {
        title: cut > 0 ? it.title.slice(cut + 2) : it.title,
        company: cut > 0 ? it.title.slice(0, cut) : '',
        url: it.link,
        location: it.region || it.country,
        type: it.type,
        posted: Date.parse(it.pubDate) || null,
        description: plain_(it.description),
      };
    });
  },

  remoteok(text) {
    return JSON.parse(text).filter(j => j && j.position).map(j => ({
      title: j.position,
      company: j.company,
      url: j.url,
      location: j.location,
      posted: j.epoch ? j.epoch * 1000 : Date.parse(j.date) || null,
      pay: payText_(j.salary_min, j.salary_max, 'USD', 'annual'),
      payUsdHourly: usdHourly_(j.salary_max || j.salary_min, 'USD', 'annual'),
      description: plain_(j.description),
    }));
  },

  workingnomads(text) {
    return JSON.parse(text).map(j => ({
      title: j.title,
      company: j.company_name,
      url: j.url,
      location: j.location,
      posted: Date.parse(j.pub_date) || null,
      description: plain_(j.description),
      tags: j.category_name || '',
    }));
  },

  remotive(text) {
    return (JSON.parse(text).jobs || []).map(j => ({
      title: j.title,
      company: j.company_name,
      url: j.url,
      location: j.candidate_required_location,
      type: j.job_type,
      posted: Date.parse(j.publication_date) || null,
      pay: j.salary || '',
      description: plain_(j.description),
    }));
  },

  greenhouse(text, src) {
    return (JSON.parse(text).jobs || [])
      .filter(j => !src.titleMustMatch || String(j.title).toLowerCase().indexOf(src.titleMustMatch) >= 0)
      .map(j => ({
        title: j.title,
        company: src.company,
        url: j.absolute_url,
        location: (j.location && j.location.name) || '',
        posted: Date.parse(j.first_published || j.updated_at) || null,
        description: plain_(decodeEntities_(j.content || '')),
      }));
  },

  // Discourse category listing (Make / n8n community). The first post is fetched later, only for new topics.
  forum(text, src) {
    return (JSON.parse(text).topic_list.topics || []).filter(t => !t.pinned).map(t => ({
      title: t.title,
      company: src.name + ' (client)',
      url: src.base + '/t/' + t.slug + '/' + t.id,
      location: 'Remote',
      type: 'Freelance project',
      posted: Date.parse(t.created_at) || null,
      replies: t.posts_count,
      description: plain_(t.excerpt || ''),
      topicJson: src.base + '/t/' + t.id + '.json',
    }));
  },
};

function finish_(j, src) {
  const title = clean_(j.title);
  const company = clean_(j.company);
  const url = normalizeUrl_(j.url || '');
  return Object.assign(j, {
    source: src.name,
    kind: src.kind,
    title,
    company,
    url,
    location: clean_(j.location),
    type: clean_(j.type),
    key: hash12_(url || title + '|' + company),
    tcKey: hash12_((title + '|' + company).toLowerCase()),
    description: String(j.description || '').slice(0, CONFIG.descriptionChars),
  });
}

// Forum listings carry no text, so pull the first post of each new topic.
function enrichForumPosts_(jobs) {
  const forum = jobs.filter(j => j.topicJson);
  if (!forum.length) return;
  fetchMany_(forum.map(j => ({ url: j.topicJson, headers: { 'User-Agent': UA }, muteHttpExceptions: true })))
    .forEach((res, i) => {
      if (res.code !== 200) return;
      try {
        const first = JSON.parse(res.text).post_stream.posts[0];
        forum[i].description = plain_(first.cooked).slice(0, CONFIG.descriptionChars);
      } catch (e) {
        // keep the listing excerpt
      }
    });
}

function rssItems_(xml) {
  return String(xml).split(/<item[\s>]/).slice(1).map(chunk => {
    const body = chunk.split('</item>')[0];
    const tag = name => {
      const m = body.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
      return m ? m[1].trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim() : '';
    };
    return {
      title: decodeEntities_(tag('title')),
      link: tag('link') || tag('guid'),
      region: decodeEntities_(tag('region')),
      country: decodeEntities_(tag('country')),
      type: tag('type'),
      pubDate: tag('pubDate'),
      description: tag('description'),
    };
  });
}

function plain_(html) {
  const s = decodeEntities_(String(html || ''))
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities_(s).replace(/\s+/g, ' ').trim();
}

function decodeEntities_(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function clean_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function payText_(min, max, currency, period) {
  if (!min && !max) return '';
  const range = min && max && min !== max ? min + '–' + max : String(max || min);
  const per = /hour/i.test(period) ? '/hour' : /month/i.test(period) ? '/month' : /year|annual/i.test(period) ? '/year' : '';
  return ((currency || '') + ' ' + range + per).trim();
}

function usdHourly_(amount, currency, period) {
  if (!amount || String(currency || 'USD').toUpperCase() !== 'USD') return null;
  if (/hour/i.test(period)) return amount;
  if (/month/i.test(period)) return amount / 173;
  if (/year|annual/i.test(period)) return amount / 2080;
  return null;
}

function normalizeUrl_(u) {
  return String(u).trim()
    .replace(/([?&])utm_[^=&#]*=[^&#]*/gi, '$1')
    .replace(/[?&]+(#|$)/, '$1')
    .replace(/\?&+/, '?')
    .replace(/&&+/g, '&');
}

function hash12_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').slice(0, 12);
}

function isoDate_(ms) {
  return Utilities.formatDate(new Date(ms), 'Asia/Jerusalem', 'yyyy-MM-dd');
}

function chunk_(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
