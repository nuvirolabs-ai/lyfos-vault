// Heuristic field extraction — mobile mirror of analyzeMessyInput
// from apps/web/src/main.jsx. Pure regex; works on any text input.

export function analyzeMessyInput(text: string) {
  const t = String(text ?? "");
  const usernameMatch =
    t.match(/(?:customer\s*id|cust\s*id|account\s*number|account\s*no|policy\s*number|policy\s*no|user(?:name)?|email|login|id)\s*[:#-]?\s*([A-Za-z0-9@._-]+)/i);
  const secretMatch =
    t.match(/(?:password|passcode|secret|pin|otp|recovery\s*key)\s*[:#-]?\s*([^\s,]+)/i);
  const ifsc = t.match(/IFSC\s*[:#-]?\s*([A-Z]{4}0\w{6})/i);
  const accountTail = t.match(/(?:ending|ends?\s*(?:in)?|a\/c\s*ending)\s*([0-9]{3,6})/i);
  const amount = t.match(/(?:balance|value|amount|sum assured|limit|worth|rs|inr)\D*([0-9][0-9,]*)/i);
  const phone  = t.match(/(\+?\d{1,3}\s?\d{4,5}\s?\d{5})/);
  const email  = t.match(/([\w.+-]+@[\w-]+\.[\w.-]+)/);

  const bankDetailsParts = [
    ifsc && `IFSC ${ifsc[1].toUpperCase()}`,
    accountTail && `account ending ${accountTail[1]}`
  ].filter(Boolean);

  const looksLikeBank =
    /bank|account|ifsc|hdfc|sbi|icici|axis|kotak|federal|yes|union|pnb|canara|saving|salary|current/i.test(t);

  return {
    title: looksLikeBank
      ? "Bank account"
      : /policy/i.test(t) ? "Insurance policy"
      : /password|account|email/i.test(t) ? "Credential"
      : "Captured record",
    type: looksLikeBank ? "bank_account"
      : /policy/i.test(t) ? "insurance_policy"
      : /password|account|email/i.test(t) ? "password"
      : "important_document",
    username: usernameMatch?.[1]  ?? email?.[1] ?? "",
    secret:   secretMatch?.[1]    ?? "",
    bankDetails: bankDetailsParts.join(". "),
    notes: t,
    extractedFields: [
      usernameMatch && { label: "Identifier",   value: usernameMatch[1] },
      secretMatch   && { label: "Sensitive",    value: "(see secret)" },
      ifsc          && { label: "IFSC",         value: ifsc[1].toUpperCase() },
      accountTail   && { label: "Account ends", value: accountTail[1] },
      amount        && { label: "Amount",       value: amount[1] },
      phone         && { label: "Phone",        value: phone[1] }
    ].filter(Boolean) as { label: string; value: string }[],
    emergencyEligible: true
  };
}
