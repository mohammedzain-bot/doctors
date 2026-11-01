'use strict';

/**
 * DR. JOHN SMITH · CLINICAL AI CONVERSATIONAL ASSISTANT
 * Understands medical enquiries, provides verified clinic information,
 * and facilitates automated appointment booking.
 */

const CLINIC_KNOWLEDGE = {
  doctorName: 'Dr. John Smith',
  specialty: 'Senior Consultant Interventional Cardiologist',
  experience: '15+ years of clinical excellence with 10,000+ patients treated',
  qualifications: 'MBBS, MD, DM Cardiology (AIIMS, New Delhi), Fellow in Interventional Cardiology (Mayo Clinic, Rochester, USA), FACC, FESC',
  awards: 'Times Health Cardiology Excellence Award 2023, National Board Certified',
  hospital: 'Apollo Hospitals, Chennai',
  address: 'Apollo Hospitals, 21 Greams Lane, Thousand Lights, Chennai — 600006',
  phone: '+91 94954 92013',
  whatsapp: '+91 94954 92013',
  hours: {
    weekdays: 'Monday to Friday: 10:00 AM – 6:00 PM',
    saturday: 'Saturday: 10:00 AM – 2:00 PM',
    sunday: 'Sunday: Closed (Emergency triage available at Apollo ER)'
  },
  specializations: [
    'Interventional Cardiology (Complex coronary angioplasty, bio-absorbable stenting, catheter procedures)',
    'Echocardiography (Advanced 2D/3D Echo, Doppler, contrast & stress imaging)',
    'Preventive Cardiology (Cardiovascular risk evaluation, hypertension, lipid & lifestyle management)',
    'Electrophysiology (Cardiac rhythm analysis, ablation, permanent pacemaker & ICD implants)',
    'Structural Heart Disease (TAVR, MitraClip, transcatheter aortic & mitral valve therapies)',
    'Advanced Heart Failure (Cardiac resynchronization therapy, medical optimization)'
  ],
  feeInfo: 'Initial comprehensive consultation is standard clinic rates. Valid government and private health insurance cashless claims accepted at Apollo Hospitals desk.'
};

/**
 * Intelligent Clinical AI Response Generator
 */
async function generateAIResponse({ visitor, conversationId, messageText, history = [], DB }) {
  const query = (messageText || '').trim();
  const lower = query.toLowerCase();

  // 1. Check for Gemini API Key if user provided one
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const response = await callGeminiLLM({ geminiKey, visitor, conversationId, messageText, history, DB });
      if (response) return response;
    } catch (err) {
      console.warn('[AI Engine] Gemini API fallback to internal Clinical NLP:', err.message);
    }
  }

  // 2. High-Precision Clinical NLP & Appointment Booking Engine
  return processClinicalNLP({ visitor, conversationId, query, lower, history, DB });
}

/**
 * Advanced Clinical NLP & Appointment Workflow
 */
async function processClinicalNLP({ visitor, conversationId, query, lower, history, DB }) {
  const visitorName = visitor?.username || 'there';
  const visitorPhone = visitor?.phone || '';
  const visitorAge = visitor?.age ? `${visitor.age} yrs` : '';

  // ── A. EMERGENCY SYMPTOM DETECTION ─────────────────────────────────────────
  const emergencyKeywords = ['heart attack', 'crushing chest', 'unconscious', 'collapsed', 'severe breathless', 'stroke', 'face drooping', 'paralysis'];
  if (emergencyKeywords.some(k => lower.includes(k))) {
    return {
      replyText: `🚨 **IMPORTANT MEDICAL ALERT**:\n\nIf you or someone with you is experiencing crushing chest pain radiating to the left arm or jaw, sudden severe breathlessness, or signs of a stroke, **this is a medical emergency**.\n\nPlease proceed immediately to the nearest Emergency Room or call **112 / 1066 (Apollo Emergency)**. Online chat cannot replace immediate emergency medical intervention.\n\nFor non-emergency reviews, Dr. John Smith's outpatient clinic is available at Apollo Hospitals, Chennai (${CLINIC_KNOWLEDGE.phone}).`,
      appointmentCreated: null
    };
  }

  // ── B. APPOINTMENT BOOKING INTENT ──────────────────────────────────────────
  const bookingKeywords = [
    'book', 'appointment', 'schedule', 'slot', 'consultation', 'visit',
    'consult', 'timing', 'reschedule', 'meet doctor', 'see doctor'
  ];
  const isBookingIntent = bookingKeywords.some(k => lower.includes(k));

  if (isBookingIntent) {
    // Check if the user is providing specific date/time details or asking to start
    const dateExtraction = extractDate(lower);
    const timeExtraction = extractTime(lower);
    const reasonExtraction = extractReason(query);

    // If we have date or user says e.g. "I want to book an appointment tomorrow at 11am"
    if (dateExtraction) {
      const apptDate = dateExtraction;
      const apptTime = timeExtraction || '11:00 AM';
      const reason = reasonExtraction || 'General Cardiology Consultation';
      const patientPhone = visitorPhone || '+91 94954 92013';

      // Create appointment in database
      const appt = DB.createAppointment({
        visitorId: visitor.id,
        conversationId,
        patientName: visitor.username,
        patientAge: visitor.age || null,
        phone: patientPhone,
        appointmentDate: apptDate,
        preferredTime: apptTime,
        reasonForVisit: reason,
        status: 'pending'
      });

      return {
        replyText: `📅 **Appointment Request Received!**\n\nThank you, **${escape(visitor.username)}**. I have initiated your consultation booking with **${CLINIC_KNOWLEDGE.doctorName}**:\n\n` +
          `• **Date:** ${apptDate}\n` +
          `• **Time Slot:** ${apptTime}\n` +
          `• **Patient:** ${visitor.username} ${visitorAge ? `(${visitorAge})` : ''}\n` +
          `• **Contact Number:** ${patientPhone}\n` +
          `• **Location:** ${CLINIC_KNOWLEDGE.address}\n` +
          `• **Reason:** ${reason}\n` +
          `• **Status:** ⏳ Pending Confirmation\n\n` +
          `Our reception desk will verify the slot and notify you shortly. If you need immediate confirmation, you can also connect via WhatsApp or Call at **${CLINIC_KNOWLEDGE.phone}**.\n\nPlease remember to bring any recent ECG, Echo, or blood reports with you.`,
        appointmentCreated: appt
      };
    }

    // If intent is booking but missing specific date/time:
    return {
      replyText: `Hello **${escape(visitorName)}**! I would be pleased to assist you in scheduling a consultation with **${CLINIC_KNOWLEDGE.doctorName}**.\n\n` +
        `**Clinic Consultation Hours:**\n` +
        `• ${CLINIC_KNOWLEDGE.hours.weekdays}\n` +
        `• ${CLINIC_KNOWLEDGE.hours.saturday}\n` +
        `• Apollo Hospitals, Greams Lane, Chennai\n\n` +
        `Please reply with your **preferred date** (e.g. *Tomorrow*, *Thursday*, or *18 Nov*) and **preferred time** (e.g. *11:00 AM* or *4:00 PM*), along with the brief reason for visit (e.g., *routine heart checkup*, *chest discomfort*, *second opinion*), and I will log your appointment immediately!`,
      appointmentCreated: null
    };
  }

  // ── C. CONSULTATION HOURS / TIMINGS ────────────────────────────────────────
  if (lower.includes('hour') || lower.includes('timing') || lower.includes('time') || lower.includes('when open') || lower.includes('available')) {
    return {
      replyText: `🕒 **${CLINIC_KNOWLEDGE.doctorName}'s Consultation Hours:**\n\n` +
        `• **Monday to Friday:** 10:00 AM – 6:00 PM\n` +
        `• **Saturday:** 10:00 AM – 2:00 PM\n` +
        `• **Sunday:** Closed for outpatient consultations (Emergency admissions open 24/7 at Apollo)\n\n` +
        `📍 **Location:** ${CLINIC_KNOWLEDGE.address}\n\n` +
        `Would you like me to book a slot for you on a specific day? Just let me know what day and time suits you best.`,
      appointmentCreated: null
    };
  }

  // ── D. DOCTOR QUALIFICATIONS, BACKGROUND & EXPERIENCE ──────────────────────
  if (lower.includes('qualification') || lower.includes('experience') || lower.includes('profile') || 
      lower.includes('background') || lower.includes('about') || lower.includes('who is') || 
      lower.includes('education') || lower.includes('degree') || lower.includes('train') || 
      lower.includes('studied') || lower.includes('credentials')) {
    return {
      replyText: `👨‍⚕️ **About ${CLINIC_KNOWLEDGE.doctorName}:**\n\n` +
        `• **Specialty:** ${CLINIC_KNOWLEDGE.specialty}\n` +
        `• **Experience:** ${CLINIC_KNOWLEDGE.experience}\n` +
        `• **Education:** MBBS, MD, and **DM Cardiology from AIIMS New Delhi**\n` +
        `• **Advanced Fellowship:** Fellow in Interventional Cardiology from **Mayo Clinic, Rochester, USA**\n` +
        `• **Fellowships:** FACC (USA), FESC (Europe)\n` +
        `• **Accolades:** Recipient of Times Health Cardiology Excellence Award\n\n` +
        `Dr. Smith specializes in precision coronary angioplasty, transcatheter structural heart interventions (TAVR), and preventive cardiac wellness. How can we help you today?`,
      appointmentCreated: null
    };
  }

  // ── E. CLINIC LOCATION / ADDRESS / DIRECTIONS ──────────────────────────────
  if (lower.includes('location') || lower.includes('address') || lower.includes('where is') || 
      lower.includes('where clinic') || lower.includes('where located') || lower.includes('directions') || 
      lower.includes('hospital') || lower.includes('map') || lower.includes('reach') || lower.includes('where')) {
    return {
      replyText: `📍 **Clinic Location & Directions:**\n\n` +
        `**${CLINIC_KNOWLEDGE.doctorName}** consults at:\n` +
        `**Apollo Hospitals**, 21 Greams Lane, Thousand Lights, Chennai — 600006.\n\n` +
        `• **Landmark:** Near Thousand Lights Mosque / Anna Salai\n` +
        `• **Facilities:** Dedicated Valet Parking, Wheelchair accessibility, In-house Cardiac Catheterization Lab, 24/7 Pharmacy & Diagnostics.\n\n` +
        `Direct clinic phone: **${CLINIC_KNOWLEDGE.phone}**.\nWould you like assistance scheduling a visit?`,
      appointmentCreated: null
    };
  }

  // ── F. CLINICAL SERVICES & PROCEDURES ──────────────────────────────────────
  if (lower.includes('service') || lower.includes('treatment') || lower.includes('procedure') || lower.includes('specializ') || lower.includes('angioplasty') || lower.includes('stent') || lower.includes('echo') || lower.includes('bypass') || lower.includes('pacemaker')) {
    const list = CLINIC_KNOWLEDGE.specializations.map(s => `• ${s}`).join('\n');
    return {
      replyText: `🩺 **Clinical Specializations & Services:**\n\n${list}\n\n` +
        `If you have specific diagnostic reports (such as an ECG, TMT, or 2D Echo) that you would like Dr. Smith to review, you can bring them to your appointment or schedule a consultation. Would you like to book an appointment?`,
      appointmentCreated: null
    };
  }

  // ── G. FEES, INSURANCE & PAYMENT ───────────────────────────────────────────
  if (lower.includes('fee') || lower.includes('cost') || lower.includes('charge') || lower.includes('price') || lower.includes('insurance') || lower.includes('mediclaim') || lower.includes('cashless')) {
    return {
      replyText: `💳 **Consultation & Insurance Information:**\n\n` +
        `• Standard consultation and follow-up fees adhere to Apollo Hospitals cardiology department guidelines.\n` +
        `• Cashless hospitalization and major private health insurances (Star Health, Care, HDFC ERGO, ICICI Lombard, Max Bupa, etc.) as well as corporate panels are supported at the hospital billing desk.\n\n` +
        `For exact procedural estimates or tariff inquiries, the reception desk is available at **${CLINIC_KNOWLEDGE.phone}**. Would you like to schedule an initial consultation?`,
      appointmentCreated: null
    };
  }

  // ── H. GREETINGS & GENERAL CONVERSATION ────────────────────────────────────
  if (lower === 'hi' || lower === 'hello' || lower === 'hey' || lower.startsWith('good morning') || lower.startsWith('good afternoon') || lower.startsWith('good evening')) {
    return {
      replyText: `Hello **${escape(visitorName)}**! Welcome to **Dr. John Smith's** cardiology clinic.\n\nI am the clinic's digital assistant. I can assist you with:\n` +
        `• 📅 **Scheduling a consultation appointment**\n` +
        `• 🕒 Checking **consultation hours** & clinic location\n` +
        `• 🩺 Information on **cardiac treatments & procedures**\n` +
        `• 📋 Preparation for your visit & reports\n\n` +
        `How may I assist your heart health today?`,
      appointmentCreated: null
    };
  }

  // ── I. DEFAULT INTELLIGENT CLINICAL CONTEXT RESPONSE ───────────────────────
  return {
    replyText: `Thank you for your message, **${escape(visitorName)}**.\n\n` +
      `I have noted your query: *"${query}"*.\n\n` +
      `Dr. John Smith's practice at **Apollo Hospitals, Chennai** is committed to comprehensive, patient-centered cardiac care. You can schedule an in-person or follow-up consultation with us anytime during clinic hours (Mon–Fri 10 AM–6 PM, Sat 10 AM–2 PM).\n\n` +
      `• To **book an appointment**, reply with your preferred day and time.\n` +
      `• For immediate phone assistance, you can call our reception at **${CLINIC_KNOWLEDGE.phone}**.\n\n` +
      `Our clinical team has also been notified and can follow up with you directly in this chat.`,
    appointmentCreated: null
  };
}

// --- Helpers for Date & Time extraction ---
function extractDate(str) {
  const now = new Date();
  if (str.includes('today')) {
    return now.toISOString().split('T')[0];
  }
  if (str.includes('tomorrow')) {
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    return tmrw.toISOString().split('T')[0];
  }
  if (str.includes('day after tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  }
  // Days of week
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < days.length; i++) {
    if (str.includes(days[i])) {
      const targetDay = i;
      const currentDay = now.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7;
      const nextDate = new Date();
      nextDate.setDate(now.getDate() + diff);
      return nextDate.toISOString().split('T')[0];
    }
  }

  // Match ISO or YYYY-MM-DD or DD/MM/YYYY or "15th Nov"
  const dateMatch = str.match(/\b(\d{4}-\d{2}-\d{2})\b/) || str.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
  if (dateMatch) {
    return dateMatch[1];
  }

  // Month names
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  for (let m = 0; m < months.length; m++) {
    if (str.includes(months[m])) {
      const dayMatch = str.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${months[m]}`, 'i')) ||
                       str.match(new RegExp(`${months[m]}\\s+(\\d{1,2})`, 'i'));
      if (dayMatch) {
        const day = dayMatch[1].padStart(2, '0');
        const monthNum = String(m + 1).padStart(2, '0');
        const year = now.getFullYear();
        return `${year}-${monthNum}-${day}`;
      }
    }
  }

  return null;
}

function extractTime(str) {
  const match = str.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))\b/i) ||
                str.match(/\b(\d{1,2}\s*(?:o'clock))\b/i);
  if (match) return match[1].toUpperCase();

  if (str.includes('morning')) return '11:00 AM';
  if (str.includes('afternoon')) return '02:30 PM';
  if (str.includes('evening')) return '04:30 PM';

  return null;
}

function extractReason(str) {
  const match = str.match(/(?:for|regarding|with|because of)\s+([^.,;]+)/i);
  if (match && match[1] && match[1].trim().length > 3) {
    return match[1].trim();
  }
  return null;
}

function escape(text) {
  if (!text) return '';
  return String(text).replace(/[<>]/g, '');
}

/**
 * Optional Gemini API Call if GEMINI_API_KEY is configured
 */
async function callGeminiLLM({ geminiKey, visitor, conversationId, messageText, history, DB }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
  const prompt = `You are the official Clinical Assistant for Dr. John Smith, a premier Senior Consultant Interventional Cardiologist at Apollo Hospitals, Chennai.
Doctor's Credentials: 15+ years experience, MBBS, MD, DM Cardiology (AIIMS), Fellow in Interventional Cardiology (Mayo Clinic, USA), FACC, FESC.
Consultation Hours: Mon-Fri 10 AM - 6 PM, Sat 10 AM - 2 PM. Phone: +91 94954 92013. Location: Apollo Hospitals, 21 Greams Lane, Chennai.
Specialties: Interventional Cardiology (angioplasty/stenting), 2D/3D Echo, Preventive Cardiology, Electrophysiology, Structural Heart (TAVR), Heart Failure.
Patient Name: ${visitor.username}, Age: ${visitor.age || 'Not provided'}, Phone: ${visitor.phone || 'Not provided'}.

Guidelines:
1. Be warm, professional, compassionate, and precise.
2. Emphasize that online chat cannot replace direct medical examination.
3. For emergency symptoms (crushing chest pain, severe breathlessness), advise immediate emergency care (Call 112 / 1066).
4. If the user wants to book an appointment, ask for preferred date, time, and reason, or confirm the booking clearly.
5. Answer questions about clinic hours, qualifications, fees, and location accurately based on the above information.

Patient Message: "${messageText}"`;

  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 500
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const json = await res.json();
  const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidate) return null;

  return {
    replyText: candidate.trim(),
    appointmentCreated: null
  };
}

module.exports = {
  CLINIC_KNOWLEDGE,
  generateAIResponse
};
