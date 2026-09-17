export const STATUSES = Object.freeze({ FOUND: 'FOUND', BLANK: 'BLANK', VERIFY: 'VERIFY' });

export function blankField() {
  return { value: '', status: STATUSES.BLANK, sources: [] };
}

export function createSchema() {
  return {
    property_address: blankField(),
    clients: [],
    other_side_agent: {
      name: blankField(),
      brokerage: blankField(),
      phone: blankField(),
      email: blankField()
    },
    transaction_coordinators: [],
    lender: {
      name: blankField(),
      company: blankField(),
      phone: blankField(),
      email: blankField()
    },
    title: {
      company: blankField(),
      contacts: [],
      phone: blankField(),
      emails: []
    },
    inspection_appointment: {
      date: blankField(),
      time: blankField(),
      inspector_name: blankField(),
      inspector_phone: blankField()
    },
    full_mls_uploaded: false,
    preapproval_uploaded: false,
    lead_source: blankField(),
    referral_fee: blankField(),
    property_access: blankField(),
    executed_date: blankField(),
    purchase_price: blankField(),
    initial_deposit: blankField(),
    loan_amount: blankField(),
    closing_date: blankField(),
    inspection_period: blankField(),
    seller_credits: blankField(),
    lender_credits: blankField(),
    other_notes: [],
    _presence_evidence: { mls: [], preapproval: [] }
  };
}

export function foundField(value, source) {
  return {
    value: String(value ?? '').trim(),
    status: STATUSES.FOUND,
    sources: source ? [source] : []
  };
}

export function verifyField(sources) {
  return { value: '', status: STATUSES.VERIFY, sources };
}

export function sourceEvidence({ filename, page = 1, quote = '', bbox = null, method = 'native_text' }) {
  return {
    filename,
    page,
    quote: String(quote).replace(/\s+/g, ' ').trim().slice(0, 500),
    bbox,
    method
  };
}

