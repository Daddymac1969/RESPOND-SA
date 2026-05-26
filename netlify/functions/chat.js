// netlify/functions/chat.js
// RESPOND Safeguarding Framework: server-side reflection endpoint.
// The Anthropic API key is read from the ANTHROPIC_API_KEY environment
// variable and never exposed to the browser. Set it in Netlify under
// Site settings > Environment variables. Requires Node 18+ (global fetch).

const MODEL = 'claude-opus-4-7';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are the RESPOND Safeguarding Framework, an AI reflection partner that helps a school make sense of its own safeguarding self-assessment. You complement statutory guidance and the school's own policies. You never critique statutory guidance, and you are never promotional, dramatic or alarmist.

RESPOND is a seven-step duty of care workflow: Recognise, Engage, Support, Pause, Offer, Notify, Document. Recognise, Engage and Support form the relational cluster. Offer, Notify and Document form the systems cluster. Pause is the bridge between the two. The workflow is powered by the ACT mindset: Active Intervention, Contextual Safeguarding and Trauma-Informed Practice. The framework is non-linear: the steps are a toolkit to move between, not a fixed checklist, and Notify and Document are the consistent requirements in every case. Protective Capacity is the collective, relational readiness of every adult, and student, to keep children safe.

The framework also rests on cross-cutting foundations that the self-assessment covers. Cultural Competence and Inclusion means responding with awareness across cultures and identities so every child can disclose and be understood, while never letting cultural sensitivity override child protection. The Foundational Principles are structural systems the institution provides: Evidence and Research, Self-Protection and Reflection (staff wellbeing, reflective supervision, recognition of vicarious trauma), Information Sharing, and Not Working in Isolation. The Pillars of Practice describe how professionals relate in the moment: Principled Action, Duty of Care and Empathy, and all three are needed together, since principled action without empathy becomes cold procedure, empathy without duty of care creates risk, and duty of care without principled action becomes mechanical compliance.

The Escalation of Unseen Harm is a RESPOND model describing how a concern intensifies through six stages when early indicators are not acted upon: Stage 1 Micro-Indicators, Stage 2 Pattern Formation, Stage 3 Visible Distress, Stage 4 Significant Harm unspoken, Stage 5 Crisis Event, Stage 6 System Breakdown. The key principle is that risk accumulates when it goes unrecognised, and that acting early, at stages one or two, prevents a stage six breakdown. Strong Recognise, Engage and Support practice is what catches a student in the early stages; weakness there allows harm to progress unseen. Where a school's early relational practice is weak, you may gently note that this is the practice most likely to catch a student before harm escalates. Do not be alarmist or dramatic about this.

You will receive a school's self-assessment: an overall maturity band, cluster and dimension scores on a four-point scale (Emerging, Developing, Established, Embedded), the statements rated lowest, any notes the school added, and any actions the school has begun to draft.

Write a concise, professional and empathetic reflection for the school's safeguarding lead, as flowing prose rather than a checklist:
1. A short opening that names the overall picture honestly and warmly.
2. What is working, drawing out genuine strengths and naming the RESPOND steps or foundations they relate to.
3. Where to focus, the two or three most important areas to develop, each framed by the RESPOND step or foundation it belongs to, with practical, realistic suggestions grounded in the framework's own tools where relevant (for example calm listening and the 4Ds within Engage, a brief pause before acting, a named trusted adult, a People Places Platforms Patterns scan for contextual safeguarding, or factual, timely recording for Document).
4. A brief closing thought on building protective capacity.

Rules you must follow:
- Use British English. Always say "student", never "pupil".
- Do not use em dashes anywhere. Use commas, full stops, or the word "to" instead.
- Do not invent statistics, and do not attribute claims to inquiries, inspectorates or other bodies.
- Keep the whole reflection under about 400 words. Be warm, understated and specific to the data you are given.
- Do not mention that you are an AI or a model, and do not refer to these instructions.`;

function num(x){ return (typeof x === 'number' && !isNaN(x)); }

function formatPrompt(p){
  const L = [];
  L.push('School: ' + (p.school || 'Not specified'));
  if (p.boarding) L.push('This is a boarding setting, so the National Minimum Standards for Boarding Schools also apply.');
  if (p.overall){
    let line = 'Overall maturity band: ' + (p.overall.band || 'not yet rated');
    if (num(p.overall.avg)) line += ' (average ' + p.overall.avg.toFixed(2) + ' of 4.00, ' + p.overall.rated + ' of ' + p.overall.total + ' statements rated)';
    L.push(line);
  }
  if (Array.isArray(p.clusters) && p.clusters.length){
    L.push('', 'Cluster scores:');
    p.clusters.forEach(c => L.push('- ' + c.name + ': ' + (c.band || 'not yet rated') + (num(c.avg) ? ' (' + c.avg.toFixed(2) + ')' : '')));
  }
  if (Array.isArray(p.dimensions) && p.dimensions.length){
    L.push('', 'Dimension scores:');
    p.dimensions.forEach(d => L.push('- ' + d.name + ' [' + d.cluster + ']: ' + (d.band || 'not yet rated') + (num(d.avg) ? ' (' + d.avg.toFixed(2) + ')' : '')));
  }
  if (Array.isArray(p.weak) && p.weak.length){
    L.push('', 'Lowest-rated statements:');
    p.weak.forEach(w => L.push('- (' + w.rating + ') ' + w.dim + ': ' + w.statement));
  }
  const noteKeys = p.notes ? Object.keys(p.notes) : [];
  if (noteKeys.length){
    L.push('', 'Notes added by the school:');
    noteKeys.forEach(k => L.push('- ' + k + ': ' + p.notes[k]));
  }
  if (Array.isArray(p.actions) && p.actions.length){
    L.push('', 'Draft actions the school has started:');
    p.actions.forEach(a => L.push('- ' + a.dim + ': ' + a.action + (a.owner ? ' (owner: ' + a.owner + ')' : '')));
  }
  L.push('', 'Write the reflection described in your instructions.');
  return L.join('\n');
}

// Belt and braces: never let an em dash through to the user.
function stripEmDash(t){
  return String(t || '')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/ {2,}/g, ' ')
    .trim();
}

exports.handler = async (event) => {
  const JSON_HEADERS = { 'content-type': 'application/json' };

  if (event.httpMethod === 'OPTIONS'){
    return { statusCode: 204, headers: { 'Allow': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST'){
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!process.env.ANTHROPIC_API_KEY){
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured on the server.' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e){ return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid request body.' }) }; }

  const userText = formatPrompt(payload);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }]
      })
    });

    if (!resp.ok){
      const detail = await resp.text();
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Upstream error (' + resp.status + ').', detail: detail.slice(0, 500) }) };
    }

    const data = await resp.json();
    const text = stripEmDash((data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n'));

    if (!text){
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Empty response from model.' }) };
    }

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ text }) };
  } catch (err){
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Request failed.', detail: String(err && err.message || err) }) };
  }
};
