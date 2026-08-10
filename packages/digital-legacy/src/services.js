import { deepFreeze } from "./constants.js";

const DEFAULT_FIELDS = Object.freeze(["account-label", "registered-email", "registered-phone", "recovery-path", "personal-instructions", "supporting-document"]);

const CATEGORY_DEFAULTS = Object.freeze({
  "banking-payments": ["account-label", "account-holder", "account-type", "masked-account-number", "customer-id", "registered-phone", "registered-email", "branch", "nominee-information", "relationship-manager", "username", "recovery-path", "supporting-document", "personal-instructions"],
  "investments-wealth": ["account-label", "account-holder", "masked-account-number", "customer-id", "registered-phone", "registered-email", "nominee-information", "provider-contact", "recovery-path", "supporting-document", "personal-instructions"],
  "social-media": ["account-label", "username", "registered-email", "registered-phone", "website", "recovery-path", "personal-instructions", "supporting-document"],
  "email-communication": ["account-label", "registered-email", "registered-phone", "username", "recovery-path", "personal-instructions", "supporting-document"],
  "devices-ecosystems": ["account-label", "username", "registered-email", "registered-phone", "asset-location", "recovery-path", "personal-instructions", "supporting-document"],
  "cloud-digital-files": ["account-label", "username", "registered-email", "website", "recovery-path", "personal-instructions", "supporting-document"],
  "government-identity": ["account-label", "account-holder", "document-number", "registered-phone", "registered-email", "renewal-date", "recovery-path", "personal-instructions", "supporting-document"],
  insurance: ["account-label", "account-holder", "policy-number", "nominee-information", "provider-contact", "renewal-date", "recovery-path", "personal-instructions", "supporting-document"],
  "property-physical-assets": ["account-label", "account-holder", "document-number", "asset-location", "nominee-information", "provider-contact", "recovery-path", "personal-instructions", "supporting-document"],
  "business-professional": ["account-label", "username", "registered-email", "registered-phone", "website", "provider-contact", "recovery-path", "personal-instructions", "supporting-document"],
  "shopping-travel-subscriptions": ["account-label", "username", "registered-email", "registered-phone", "renewal-date", "recovery-path", "personal-instructions", "supporting-document"],
  "health-medical": ["account-label", "account-holder", "document-number", "provider-contact", "recovery-path", "personal-instructions", "supporting-document"],
  "memories-personal-archives": ["account-label", "asset-location", "recovery-path", "personal-instructions", "supporting-document"],
  "password-managers-recovery": ["account-label", "username", "registered-email", "asset-location", "recovery-path", "personal-instructions", "supporting-document"],
  custom: DEFAULT_FIELDS
});

const CATEGORY_ACTIONS = Object.freeze({
  "banking-payments": ["transfer", "contact_provider", "release_information", "custom"],
  "investments-wealth": ["transfer", "contact_provider", "release_information", "custom"],
  "social-media": ["memorialise", "close", "delete", "archive", "custom"],
  "email-communication": ["archive", "close", "delete", "release_information", "custom"],
  "devices-ecosystems": ["transfer", "archive", "release_information", "custom"],
  "cloud-digital-files": ["transfer", "archive", "delete", "release_information", "custom"],
  "government-identity": ["contact_provider", "release_information", "custom"],
  insurance: ["contact_provider", "release_information", "custom"],
  "property-physical-assets": ["transfer", "contact_provider", "release_information", "custom"],
  "business-professional": ["transfer", "close", "archive", "contact_provider", "custom"],
  "shopping-travel-subscriptions": ["close", "delete", "contact_provider", "custom"],
  "health-medical": ["archive", "contact_provider", "release_information", "custom"],
  "memories-personal-archives": ["transfer", "archive", "release_information", "custom"],
  "password-managers-recovery": ["release_information", "custom"],
  custom: ["transfer", "memorialise", "close", "delete", "archive", "contact_provider", "release_information", "custom"]
});

const categoryIcons = Object.freeze({
  "banking-payments": "banking",
  "investments-wealth": "investments",
  "social-media": "social",
  "email-communication": "communication",
  "devices-ecosystems": "devices",
  "cloud-digital-files": "cloud",
  "government-identity": "government",
  insurance: "insurance",
  "property-physical-assets": "property",
  "business-professional": "business",
  "shopping-travel-subscriptions": "subscriptions",
  "health-medical": "health",
  "memories-personal-archives": "memories",
  "password-managers-recovery": "recovery",
  custom: "custom"
});

function titleFromId(id) {
  return id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function normalizeRow(row) {
  if (typeof row === "string") return { id: row, name: titleFromId(row) };
  if (Array.isArray(row)) return { id: row[0], name: row[1], aliases: row[2] ?? [], websiteDomain: row[3] };
  return row;
}

// `sortBase` keeps ordering stable when a category is assembled from several
// calls (a universal group plus one group per region). Universal rows sort
// first; each region pack occupies its own band.
function buildServices(categoryId, rows, options = {}) {
  const base = options.sortBase ?? 0;
  return rows.map((input, index) => {
    const row = normalizeRow(input);
    return {
      id: row.id,
      categoryId,
      slug: row.id,
      name: row.name,
      aliases: row.aliases ?? [],
      iconKey: categoryIcons[categoryId],
      iconSource: "generic",
      brandAssetApproved: false,
      websiteDomain: row.websiteDomain,
      countryCodes: row.countryCodes ?? options.countryCodes ?? [],
      suggestedFieldKeys: row.suggestedFieldKeys ?? CATEGORY_DEFAULTS[categoryId] ?? DEFAULT_FIELDS,
      suggestedActions: row.suggestedActions ?? CATEGORY_ACTIONS[categoryId],
      defaultSensitivityLevel: row.sensitivityLevel ?? options.sensitivityLevel ?? "high",
      isFeatured: row.isFeatured ?? index < (options.featuredCount ?? 6),
      isEnabled: true,
      sortOrder: base + index + 1
    };
  });
}

// Sort bands, so a category assembled from several calls stays deterministic.
const BAND = Object.freeze({ universal: 0, IN: 100, US: 200, GB: 300, AE: 400 });

const groups = [
  // ---- banking & payments -------------------------------------------------
  buildServices("banking-payments", [
    ["paypal", "PayPal"], ["google-pay", "Google Pay", ["GPay"]], ["apple-pay", "Apple Pay"], ["amazon-pay", "Amazon Pay"], ["wise", "Wise", ["TransferWise"]], ["other-bank", "Other bank"], ["other-payment-account", "Other payment account"]
  ], { featuredCount: 2, sortBase: BAND.universal }),
  buildServices("banking-payments", [
    ["hdfc-bank", "HDFC Bank"], ["icici-bank", "ICICI Bank"], ["state-bank-of-india", "State Bank of India", ["SBI"]], ["axis-bank", "Axis Bank"], ["bank-of-baroda", "Bank of Baroda", ["BOB"]], ["kotak-mahindra-bank", "Kotak Mahindra Bank"], ["punjab-national-bank", "Punjab National Bank", ["PNB"]], ["indusind-bank", "IndusInd Bank"], ["yes-bank", "Yes Bank"], ["idfc-first-bank", "IDFC FIRST Bank"], ["federal-bank", "Federal Bank"], ["au-small-finance-bank", "AU Small Finance Bank"], ["paytm", "Paytm"], ["phonepe", "PhonePe"]
  ], { countryCodes: ["IN"], featuredCount: 10, sortBase: BAND.IN }),
  buildServices("banking-payments", [
    ["chase-bank", "Chase"], ["bank-of-america", "Bank of America", ["BofA"]], ["wells-fargo", "Wells Fargo"], ["citibank", "Citibank", ["Citi"]], ["capital-one", "Capital One"], ["us-bank", "U.S. Bank"], ["pnc-bank", "PNC Bank"], ["truist", "Truist"], ["ally-bank", "Ally Bank"], ["venmo", "Venmo"], ["zelle", "Zelle"], ["cash-app", "Cash App"]
  ], { countryCodes: ["US"], featuredCount: 8, sortBase: BAND.US }),
  buildServices("banking-payments", [
    ["barclays", "Barclays"], ["hsbc-uk", "HSBC UK"], ["lloyds-bank", "Lloyds Bank"], ["natwest", "NatWest"], ["santander-uk", "Santander UK"], ["halifax", "Halifax"], ["nationwide-uk", "Nationwide"], ["monzo", "Monzo"], ["starling-bank", "Starling Bank"], ["revolut", "Revolut"]
  ], { countryCodes: ["GB"], featuredCount: 8, sortBase: BAND.GB }),
  buildServices("banking-payments", [
    ["emirates-nbd", "Emirates NBD"], ["first-abu-dhabi-bank", "First Abu Dhabi Bank", ["FAB"]], ["adcb", "ADCB", ["Abu Dhabi Commercial Bank"]], ["mashreq", "Mashreq"], ["dubai-islamic-bank", "Dubai Islamic Bank", ["DIB"]], ["adib", "ADIB", ["Abu Dhabi Islamic Bank"]], ["rakbank", "RAKBANK"], ["wio-bank", "Wio Bank"]
  ], { countryCodes: ["AE"], featuredCount: 7, sortBase: BAND.AE }),

  // ---- investments & wealth -----------------------------------------------
  buildServices("investments-wealth", [
    ["bonds", "Bonds"], ["cryptocurrency-wallets", "Cryptocurrency wallets", ["Crypto wallet"]], ["other-investment", "Other investment"]
  ], { featuredCount: 1, sortBase: BAND.universal }),
  buildServices("investments-wealth", [
    ["zerodha", "Zerodha"], ["groww", "Groww"], ["upstox", "Upstox"], ["angel-one", "Angel One"], ["icici-direct", "ICICI Direct"], ["hdfc-securities", "HDFC Securities"], ["kotak-securities", "Kotak Securities"], ["sharekhan", "Sharekhan"], ["mutual-fund-accounts", "Mutual fund accounts", ["MF"]], ["demat-accounts", "Demat accounts"], ["national-pension-system", "National Pension System", ["NPS"]], ["employee-provident-fund", "Employee Provident Fund", ["EPF", "PF"]], ["public-provident-fund", "Public Provident Fund", ["PPF"]], ["fixed-deposits", "Fixed deposits", ["FD"]]
  ], { countryCodes: ["IN"], featuredCount: 8, sortBase: BAND.IN }),
  buildServices("investments-wealth", [
    ["plan-401k", "401(k)"], ["roth-ira", "Roth IRA"], ["traditional-ira", "Traditional IRA"], ["fidelity", "Fidelity"], ["charles-schwab", "Charles Schwab"], ["vanguard-us", "Vanguard"], ["robinhood", "Robinhood"], ["etrade", "E*TRADE"], ["coinbase", "Coinbase"], ["hsa-account", "HSA", ["Health Savings Account"]], ["plan-529", "529 plan"], ["treasury-bonds-us", "Treasury bonds", ["I bonds", "TreasuryDirect"]], ["certificates-of-deposit", "Certificates of deposit", ["CD"]]
  ], { countryCodes: ["US"], featuredCount: 9, sortBase: BAND.US }),
  buildServices("investments-wealth", [
    ["stocks-shares-isa", "Stocks & Shares ISA"], ["cash-isa", "Cash ISA"], ["lifetime-isa", "Lifetime ISA", ["LISA"]], ["sipp", "SIPP", ["Self-invested personal pension"]], ["workplace-pension", "Workplace pension"], ["hargreaves-lansdown", "Hargreaves Lansdown"], ["vanguard-uk", "Vanguard UK"], ["aj-bell", "AJ Bell"], ["interactive-investor", "Interactive Investor"], ["trading-212", "Trading 212"], ["freetrade", "Freetrade"], ["premium-bonds", "Premium Bonds", ["NS&I"]]
  ], { countryCodes: ["GB"], featuredCount: 8, sortBase: BAND.GB }),
  buildServices("investments-wealth", [
    ["end-of-service-gratuity", "End-of-service gratuity"], ["gpssa-pension", "GPSSA pension"], ["national-bonds-uae", "National Bonds"], ["sarwa", "Sarwa"], ["interactive-brokers", "Interactive Brokers", ["IBKR"]], ["saxo-bank", "Saxo Bank"], ["etoro", "eToro"]
  ], { countryCodes: ["AE"], featuredCount: 6, sortBase: BAND.AE }),
  buildServices("social-media", [
    ["facebook", "Facebook"], ["instagram", "Instagram", ["Insta"]], ["x", "X", ["Twitter"]], ["linkedin", "LinkedIn"], ["snapchat", "Snapchat"], ["reddit", "Reddit"], ["pinterest", "Pinterest"], ["threads", "Threads"], ["youtube", "YouTube"], ["other-social-account", "Other social account"]
  ], { sensitivityLevel: "standard" }),
  buildServices("email-communication", [
    ["gmail", "Gmail", ["Google Mail"]], ["outlook", "Outlook", ["Hotmail"]], ["yahoo-mail", "Yahoo Mail"], ["proton-mail", "Proton Mail"], ["icloud-mail", "iCloud Mail"], ["whatsapp", "WhatsApp"], ["telegram", "Telegram"], ["signal", "Signal"], ["slack", "Slack"], ["discord", "Discord"], ["other-communication-account", "Other communication account"]
  ]),
  buildServices("devices-ecosystems", [
    ["apple-id", "Apple ID", ["Apple Account", "iCloud"]], ["google-account", "Google Account", ["Gmail", "Google"]], ["microsoft-account", "Microsoft Account", ["Microsoft 365"]], ["samsung-account", "Samsung Account"], ["laptop", "Laptop"], ["desktop", "Desktop"], ["mobile-phone", "Mobile phone", ["Phone"]], ["tablet", "Tablet"], ["smartwatch", "Smartwatch"], ["external-hard-drive", "External hard drive"], ["network-storage", "Network storage", ["NAS"]], ["other-device", "Other device"]
  ]),
  buildServices("cloud-digital-files", [
    ["google-drive", "Google Drive"], ["icloud-drive", "iCloud Drive"], ["microsoft-onedrive", "Microsoft OneDrive", ["OneDrive"]], ["dropbox", "Dropbox"], ["box", "Box"], ["pcloud", "pCloud"], ["amazon-photos", "Amazon Photos"], ["google-photos", "Google Photos"], ["other-cloud-storage", "Other cloud storage"]
  ]),
  // ---- government & identity ----------------------------------------------
  buildServices("government-identity", [
    ["passport", "Passport"], ["driving-licence", "Driving licence", ["Driving license", "DL"]], ["other-government-identity", "Other government identity"]
  ], { sensitivityLevel: "critical", featuredCount: 2, sortBase: BAND.universal }),
  buildServices("government-identity", [
    ["aadhaar", "Aadhaar"], ["pan", "PAN", ["Permanent Account Number"]], ["voter-id", "Voter ID"], ["digilocker", "DigiLocker"], ["income-tax-account", "Income Tax account"], ["gst-account", "GST account"], ["government-pension-account", "Government pension account"]
  ], { countryCodes: ["IN"], sensitivityLevel: "critical", featuredCount: 5, sortBase: BAND.IN }),
  buildServices("government-identity", [
    ["social-security-number", "Social Security number", ["SSN"]], ["state-id-us", "State ID"], ["irs-account", "IRS account"], ["medicare-account", "Medicare"], ["green-card", "Green card", ["Permanent Resident Card"]], ["voter-registration-us", "Voter registration"]
  ], { countryCodes: ["US"], sensitivityLevel: "critical", featuredCount: 5, sortBase: BAND.US }),
  buildServices("government-identity", [
    ["national-insurance-number", "National Insurance number", ["NI number"]], ["hmrc-account", "HMRC account"], ["nhs-number", "NHS number"], ["government-gateway", "Government Gateway"], ["electoral-roll", "Electoral roll"]
  ], { countryCodes: ["GB"], sensitivityLevel: "critical", featuredCount: 5, sortBase: BAND.GB }),
  buildServices("government-identity", [
    ["emirates-id", "Emirates ID"], ["uae-pass", "UAE Pass"], ["residence-visa", "Residence visa"], ["labour-card", "Labour card"]
  ], { countryCodes: ["AE"], sensitivityLevel: "critical", featuredCount: 4, sortBase: BAND.AE }),
  buildServices("insurance", [
    ["life-insurance", "Life insurance"], ["health-insurance", "Health insurance"], ["vehicle-insurance", "Vehicle insurance"], ["home-insurance", "Home insurance"], ["travel-insurance", "Travel insurance"], ["employer-insurance", "Employer insurance"], ["other-insurance", "Other insurance"]
  ]),
  buildServices("property-physical-assets", [
    ["residential-property", "Residential property"], ["commercial-property", "Commercial property"], ["land", "Land"], ["vehicle", "Vehicle"], ["jewellery", "Jewellery", ["Jewelry"]], ["storage-locker", "Storage locker"], ["safe", "Safe"], ["other-physical-asset", "Other physical asset"]
  ]),
  buildServices("business-professional", [
    ["company-email", "Company email"], ["google-workspace", "Google Workspace", ["G Suite"]], ["microsoft-365", "Microsoft 365", ["Office 365"]], ["github", "GitHub"], ["gitlab", "GitLab"], ["domain-registrar", "Domain registrar"], ["website-hosting", "Website hosting"], ["aws", "AWS", ["Amazon Web Services"]], ["azure", "Azure", ["Microsoft Azure"]], ["google-cloud", "Google Cloud", ["GCP"]], ["stripe", "Stripe"], ["razorpay", "Razorpay"], ["shopify", "Shopify"], ["zoho", "Zoho"], ["accounting-software", "Accounting software"], ["crm", "CRM"], ["other-business-system", "Other business system"]
  ]),
  // ---- shopping, travel & subscriptions -----------------------------------
  // Previously one India-flavoured list with no country tag at all, so Flipkart
  // and Swiggy were being offered worldwide.
  buildServices("shopping-travel-subscriptions", [
    ["amazon-shopping", "Amazon"], ["uber", "Uber"], ["airbnb", "Airbnb"], ["booking-com", "Booking.com"], ["airline-accounts", "Airline accounts"], ["hotel-accounts", "Hotel accounts"], ["streaming-subscriptions", "Streaming subscriptions"], ["software-subscriptions", "Software subscriptions"], ["other-subscription", "Other subscription"]
  ], { sensitivityLevel: "standard", featuredCount: 6, sortBase: BAND.universal }),
  buildServices("shopping-travel-subscriptions", [
    ["flipkart", "Flipkart"], ["myntra", "Myntra"], ["swiggy", "Swiggy"], ["zomato", "Zomato"], ["ola", "Ola"]
  ], { countryCodes: ["IN"], sensitivityLevel: "standard", featuredCount: 4, sortBase: BAND.IN }),
  buildServices("shopping-travel-subscriptions", [
    ["walmart", "Walmart"], ["target-store", "Target"], ["costco", "Costco"], ["doordash", "DoorDash"], ["lyft", "Lyft"], ["instacart", "Instacart"]
  ], { countryCodes: ["US"], sensitivityLevel: "standard", featuredCount: 4, sortBase: BAND.US }),
  buildServices("shopping-travel-subscriptions", [
    ["tesco", "Tesco"], ["sainsburys", "Sainsbury's"], ["ocado", "Ocado"], ["asos", "ASOS"], ["deliveroo", "Deliveroo"], ["just-eat", "Just Eat"]
  ], { countryCodes: ["GB"], sensitivityLevel: "standard", featuredCount: 4, sortBase: BAND.GB }),
  buildServices("shopping-travel-subscriptions", [
    ["noon", "Noon"], ["careem", "Careem"], ["talabat", "Talabat"]
  ], { countryCodes: ["AE"], sensitivityLevel: "standard", featuredCount: 3, sortBase: BAND.AE }),
  buildServices("health-medical", [
    ["health-records", "Health records"], ["hospital-portals", "Hospital portals"], ["diagnostic-reports", "Diagnostic reports"], ["prescription-history", "Prescription history"], ["health-insurance-portal", "Health insurance portal"], ["fitness-accounts", "Fitness accounts"], ["emergency-health-instructions", "Emergency health instructions"], ["other-medical-information", "Other medical information"]
  ], { sensitivityLevel: "critical" }),
  buildServices("memories-personal-archives", [
    ["family-photos", "Family photos"], ["personal-videos", "Personal videos"], ["voice-recordings", "Voice recordings"], ["letters", "Letters"], ["journals", "Journals"], ["creative-work", "Creative work"], ["family-history", "Family history"], ["important-contacts", "Important contacts"], ["personal-messages", "Personal messages"], ["other-memories", "Other memories"]
  ]),
  buildServices("password-managers-recovery", [
    ["apple-passwords", "Apple Passwords"], ["google-password-manager", "Google Password Manager"], ["onepassword", "1Password", ["One Password"]], ["bitwarden", "Bitwarden"], ["dashlane", "Dashlane"], ["lastpass", "LastPass"], ["proton-pass", "Proton Pass"], ["hardware-security-keys", "Hardware security keys", ["YubiKey", "Security key"]], ["recovery-code-archive", "Recovery code archive"], ["other-password-manager", "Other password manager"]
  ], { sensitivityLevel: "critical" })
];

export const LEGACY_SERVICE_TEMPLATES = deepFreeze(groups.flat());
