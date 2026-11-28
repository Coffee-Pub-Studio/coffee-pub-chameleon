// The airlines a flight can link to (documentation/plans/plan-flight-airline-links.md, step 2): about 50 major airlines, each with
// the address of its own check-in page and its own flight-status page, which airline a flight is (its number's prefix first, then
// the airline's name as typed), and the links to offer. Pure: no page, no host and no network, so the module's test runs it on its
// own. It expects `flightNumberOf` (travel-lib-object.js) in scope when airlineOf is called.
//
// Where the list comes from: written by hand from each airline's own public website, never copied from a dataset. A person must
// open both addresses of every entry and set `checked` to the month (`YYYY-MM`) before release; until then it is `null` and the
// module's test lists them. An airline not in the list gives no links.
//
// What a link carries: by default nothing, the airline's plain page. An entry with `statusLink` (a template using only {number},
// the flight number's digits, and {date}, the departure day as YYYY-MM-DD) gets its flight-status link filled in. Never a
// passenger's name, a booking reference or a seat; a check-in link never carries anything.
const AIRLINES = Object.freeze([
  { code: 'WN', icao: 'SWA', name: 'Southwest Airlines', aliases: ['Southwest'], checkIn: 'https://www.southwest.com/air/check-in/', status: 'https://www.southwest.com/air/flight-status/' },
  { code: 'AA', icao: 'AAL', name: 'American Airlines', aliases: ['American'], checkIn: 'https://www.aa.com/checkin/viewReservationsAccess', status: 'https://www.aa.com/travelInformation/flights/status' },
  { code: 'DL', icao: 'DAL', name: 'Delta Air Lines', aliases: ['Delta', 'Delta Airlines'], checkIn: 'https://www.delta.com/us/en/check-in-security/overview', status: 'https://www.delta.com/flightstatus/search' },
  { code: 'UA', icao: 'UAL', name: 'United Airlines', aliases: ['United'], checkIn: 'https://www.united.com/en/us/checkin', status: 'https://www.united.com/en/us/flightstatus' },
  { code: 'AS', icao: 'ASA', name: 'Alaska Airlines', aliases: ['Alaska'], checkIn: 'https://reservations.alaskaair.com/checkin', status: 'https://www.alaskaair.com/flightstatus' },
  { code: 'B6', icao: 'JBU', name: 'JetBlue Airways', aliases: ['JetBlue'], checkIn: 'https://www.jetblue.com/help/checking-in/check-in-online', status: 'https://www.jetblue.com/flight-tracker-and-status' },
  { code: 'F9', icao: 'FFT', name: 'Frontier Airlines', aliases: ['Frontier'], checkIn: 'https://www.flyfrontier.com/travel/my-trips/check-in/', status: 'https://booking.flyfrontier.com/Flight/Status' },
  { code: 'G4', icao: 'AAY', name: 'Allegiant Air', aliases: ['Allegiant'], checkIn: 'https://www.allegiantair.com/check-in', status: 'https://www.allegiantair.com/flight-status' },
  { code: 'HA', icao: 'HAL', name: 'Hawaiian Airlines', aliases: ['Hawaiian'], checkIn: 'https://www.hawaiianairlines.com/content/ha/travel-info/at-the-airport/airport-check-in-options' },
  { code: 'AC', icao: 'ACA', name: 'Air Canada', checkIn: 'https://www.aircanada.com/ca/en/aco/home/book/check-in.html', status: 'https://www.aircanada.com/us/en/aco/home/fly/flight-information.html' },
  { code: 'WS', icao: 'WJA', name: 'WestJet', checkIn: 'https://www.westjet.com/en-us/manage/check-in', status: 'https://www.westjet.com/en-us/flights/status' },
  { code: 'BA', icao: 'BAW', name: 'British Airways', aliases: ['BA'], checkIn: 'https://www.britishairways.com/travel/olcilandingpageauthreq/public/en_gb', status: 'https://www.britishairways.com/travel/flightinformation/public/en_gb' },
  { code: 'VS', icao: 'VIR', name: 'Virgin Atlantic', checkIn: 'https://www.virginatlantic.com/PCCOciWeb/findBy', status: 'https://www.virginatlantic.com/flightinfo/viewFlightStatusByOrigin' },
  { code: 'LH', icao: 'DLH', name: 'Lufthansa', aliases: ['Lufthansa German Airlines'], checkIn: 'https://www.lufthansa.com/xx/en/online-check-in', status: 'https://www.lufthansa.com/xx/en/flight-status' },
  { code: 'AF', icao: 'AFR', name: 'Air France', checkIn: 'https://wwws.airfrance.us/check-in', status: 'https://wwws.airfrance.us/flight-status' },
  { code: 'KL', icao: 'KLM', name: 'KLM Royal Dutch Airlines', aliases: ['KLM'], checkIn: 'https://www.klm.com/check-in', status: 'https://www.klm.com/flight-status' },
  { code: 'IB', icao: 'IBE', name: 'Iberia', checkIn: 'https://www.iberia.com/us/check-in/', status: 'https://www.iberia.com/us/flight-status/' },
  { code: 'VY', icao: 'VLG', name: 'Vueling', aliases: ['Vueling Airlines'], checkIn: 'https://www.vueling.com/en/vueling-services/check-in', status: 'https://www.vueling.com/en/vueling-services/flight-status' },
  { code: 'FR', icao: 'RYR', name: 'Ryanair', checkIn: 'https://www.ryanair.com/gb/en/lp/check-in' },
  { code: 'U2', icao: 'EZY', name: 'easyJet', aliases: ['easy jet'], checkIn: 'https://www.easyjet.com/en/help/booking-and-check-in/check-in', status: 'https://www.easyjet.com/en/flight-tracker' },
  { code: 'W6', icao: 'WZZ', name: 'Wizz Air', aliases: ['Wizzair'], checkIn: 'https://www.wizzair.com/en-gb/booking/check-in', status: 'https://www.wizzair.com/en-gb/flights/flight-status' },
  { code: 'DY', icao: 'NOZ', name: 'Norwegian', aliases: ['Norwegian Air Shuttle'], checkIn: 'https://www.norwegian.com/en/check-in/', status: 'https://www.norwegian.com/en/flight-status/' },
  { code: 'TP', icao: 'TAP', name: 'TAP Air Portugal', aliases: ['TAP'], checkIn: 'https://www.flytap.com/en-us/check-in-information', status: 'https://www.flytap.com/en-us/tools/flight-information-tool' },
  { code: 'LX', icao: 'SWR', name: 'Swiss International Air Lines', aliases: ['Swiss', 'Swiss Air'], checkIn: 'https://www.swiss.com/us/en/prepare/check-in', status: 'https://www.swiss.com/us/en/prepare/flight-status' },
  { code: 'OS', icao: 'AUA', name: 'Austrian Airlines', aliases: ['Austrian'], checkIn: 'https://www.austrian.com/us/en/check-in', status: 'https://www.austrian.com/us/en/flight-status' },
  { code: 'SK', icao: 'SAS', name: 'Scandinavian Airlines', aliases: ['SAS'], checkIn: 'https://www.flysas.com/en/check-in/', status: 'https://www.flysas.com/en/flight-status/' },
  { code: 'AY', icao: 'FIN', name: 'Finnair', checkIn: 'https://www.finnair.com/en/check-in', status: 'https://www.finnair.com/en/flight-status' },
  { code: 'EI', icao: 'EIN', name: 'Aer Lingus', checkIn: 'https://www.aerlingus.com/check-in/', status: 'https://www.aerlingus.com/travel-information/flight-status/' },
  { code: 'TK', icao: 'THY', name: 'Turkish Airlines', aliases: ['Turkish'], checkIn: 'https://www.turkishairlines.com/en-int/flights/check-in/', status: 'https://www.turkishairlines.com/en-int/flights/flight-status/' },
  { code: 'EK', icao: 'UAE', name: 'Emirates', checkIn: 'https://www.emirates.com/english/manage-booking/online-check-in/', status: 'https://www.emirates.com/english/manage-booking/flight-status/' },
  { code: 'QR', icao: 'QTR', name: 'Qatar Airways', aliases: ['Qatar'], checkIn: 'https://www.qatarairways.com/en/check-in.html', status: 'https://www.qatarairways.com/en/flight-status.html' },
  { code: 'EY', icao: 'ETD', name: 'Etihad Airways', aliases: ['Etihad'], checkIn: 'https://www.etihad.com/en/manage/check-in', status: 'https://www.etihad.com/en/manage/flight-status' },
  { code: 'SV', icao: 'SVA', name: 'Saudia', aliases: ['Saudi Arabian Airlines'], checkIn: 'https://www.saudia.com/before-flying/check-in', status: 'https://www.saudia.com/before-flying/flight-status' },
  { code: 'ET', icao: 'ETH', name: 'Ethiopian Airlines', aliases: ['Ethiopian'], checkIn: 'https://www.ethiopianairlines.com/us/book/check-in/web-check-in', status: 'https://www.ethiopianairlines.com/et/book/booking/flight-status' },
  { code: 'KQ', icao: 'KQA', name: 'Kenya Airways', checkIn: 'https://www.kenya-airways.com/en/book-manage/post-booking/check-in/', status: 'https://www.kenya-airways.com/en/book-manage/flight-status/' },
  { code: 'SQ', icao: 'SIA', name: 'Singapore Airlines', checkIn: 'https://www.singaporeair.com/en_UK/us/travel-info/check-in/' },
  { code: 'CX', icao: 'CPA', name: 'Cathay Pacific', aliases: ['Cathay Pacific Airways'], checkIn: 'https://www.cathaypacific.com/mb/', status: 'https://www.cathaypacific.com/cx/en_US/prepare-trip/flight-status.html' },
  { code: 'QF', icao: 'QFA', name: 'Qantas', aliases: ['Qantas Airways'], checkIn: 'https://www.qantas.com/en-au/manage-booking/check-in', status: 'https://www.qantas.com/en-au/travel-information/flight-status' },
  { code: 'NZ', icao: 'ANZ', name: 'Air New Zealand', checkIn: 'https://www.airnewzealand.com/en-nz/online-check-in', status: 'https://www.airnewzealand.com/en-nz/travel-info/arrivals-and-departures' },
  { code: 'JL', icao: 'JAL', name: 'Japan Airlines', aliases: ['JAL'], checkIn: 'https://www.jal.co.jp/en/inter/checkin/', status: 'https://www.jal.co.jp/en/inter/flight-status/' },
  { code: 'NH', icao: 'ANA', name: 'All Nippon Airways', aliases: ['ANA'], checkIn: 'https://www.ana.co.jp/en/us/guide/boarding-procedures/checkin/online-checkin/' },
  { code: 'KE', icao: 'KAL', name: 'Korean Air', checkIn: 'https://www.koreanair.com/check-in', status: 'https://www.koreanair.com/flight-status' },
  { code: 'CI', icao: 'CAL', name: 'China Airlines', checkIn: 'https://www.china-airlines.com/us/en/booking/check-in', status: 'https://www.china-airlines.com/us/en/flights/flight-status' },
  { code: 'BR', icao: 'EVA', name: 'EVA Air', checkIn: 'https://www.evaair.com/en-global/manage-my-trip/check-in/', status: 'https://www.evaair.com/en-global/flight-information/flight-status/' },
  { code: 'AI', icao: 'AIC', name: 'Air India', checkIn: 'https://www.airindia.com/in/en/manage/web-check-in.html', status: 'https://www.airindia.com/in/en/manage/flight-status.html' },
  { code: '6E', icao: 'IGO', name: 'IndiGo', aliases: ['Indigo Airlines'], checkIn: 'https://www.goindigo.in/web-check-in.html', status: 'https://www.goindigo.in/flight-status.html' },
  { code: 'AK', icao: 'AXM', name: 'AirAsia', aliases: ['Air Asia'], checkIn: 'https://www.airasia.com/check-in/en/gb', status: 'https://www.airasia.com/flightstatus/en/gb' },
  { code: 'MH', icao: 'MAS', name: 'Malaysia Airlines', checkIn: 'https://www.malaysiaairlines.com/us/en/travel-info/check-in.html' },
  { code: 'TG', icao: 'THA', name: 'Thai Airways', aliases: ['Thai Airways International', 'Thai'], checkIn: 'https://www.thaiairways.com/en-us/content/check-in/', status: 'https://www.thaiairways.com/en-th/book/flight-status/' },
  { code: 'LA', icao: 'LAN', name: 'LATAM Airlines', aliases: ['LATAM'], checkIn: 'https://www.latamairlines.com/us/en/check-in', status: 'https://www.latamairlines.com/us/en/flight-status' },
  { code: 'AV', icao: 'AVA', name: 'Avianca', checkIn: 'https://www.avianca.com/us/en/prepare-for-your-trip/check-in/', status: 'https://www.avianca.com/us/en/prepare-for-your-trip/flight-status/' },
  { code: 'CM', icao: 'CMP', name: 'Copa Airlines', aliases: ['Copa'], checkIn: 'https://www.copaair.com/en-us/web-check-in/', status: 'https://www.copaair.com/en-us/flight-status/' },
  { code: 'AM', icao: 'AMX', name: 'Aeromexico', aliases: ['Aero Mexico'], checkIn: 'https://aeromexico.com/en-us/check-in', status: 'https://aeromexico.com/en-us/flight-status' },
  { code: 'Y4', icao: 'VOI', name: 'Volaris', checkIn: 'https://www.volaris.com/check-in', status: 'https://www.volaris.com/flight-status' },
  { code: 'G3', icao: 'GLO', name: 'GOL Linhas Aereas', aliases: ['GOL'], checkIn: 'https://www.voegol.com.br/en/informacoes/como-fazer-check-in', status: 'https://www.voegol.com.br/en/informacoes' },
  { code: 'AD', icao: 'AZU', name: 'Azul Brazilian Airlines', aliases: ['Azul'], checkIn: 'https://www.voeazul.com.br/us/en/check-in', status: 'https://www.voeazul.com.br/us/en/flight-status' },
].map((a) => Object.freeze({ checked: null, ...a, aliases: Object.freeze(a.aliases || []) })));

// A name as it is compared: lower case, accents and punctuation dropped, spaces kept single.
function airlineText(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// The airline a flight is, or null. The flight number's prefix first (two characters against `code`, three letters against
// `icao`); the prefix is the airline that sold the ticket, so it wins when the typed airline is another. Then the airline as
// typed against each name and alias: the whole text, else the longest name or alias (of six characters or more) that stands in
// it as whole words ("Southwest Airlines Co"). A tie or no match is null. `list` is the airlines to look in (the checks hand in
// their own).
function airlineOf(number, operator, list = AIRLINES) {
  const clean = flightNumberOf(typeof number === 'string' ? number : '');
  if (clean) {
    const prefix = clean.split(' ')[0];
    const hit = list.find((a) => (prefix.length === 3 ? a.icao === prefix : a.code === prefix));
    if (hit) return hit;
  }
  const typed = airlineText(operator);
  if (!typed) return null;
  const names = (a) => [a.name, ...(a.aliases || [])].map(airlineText);
  const whole = list.find((a) => names(a).includes(typed));
  if (whole) return whole;
  let best = null;
  let bestLength = 0;
  let tied = false;
  for (const a of list) {
    for (const n of names(a)) {
      if (n.length < 6 || !` ${typed} `.includes(` ${n} `)) continue;
      if (n.length > bestLength) { best = a; bestLength = n.length; tied = false; } else if (n.length === bestLength && a !== best) tied = true;
    }
  }
  return best && !tied ? best : null;
}

// Whether an address is one a link may use: https, a host, no sign-in in it.
function airlineAddressOk(address) {
  try {
    const u = new URL(address);
    return u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === '';
  } catch { return false; }
}

// Which links are on offer at `now` (a Date, the device's clock) for a flight: check-in from 48 hours before departure until it
// departs, flight status from 48 hours before departure until the day it lands ends. The times are local wall times, as the
// plan keeps them; the airport's zone is not known here, which a 48-hour window absorbs. A flight with no date offers neither.
function flightWindow(item, now) {
  const none = { checkIn: false, status: false };
  const at = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(typeof s === 'string' ? s : '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
  };
  if (!item || !(now instanceof Date) || Number.isNaN(now.getTime())) return none;
  const leaves = at(item.date && item.time ? `${item.date}T${item.time}` : item.date);
  if (!leaves) return none;
  const lands = at(item.arrives) || leaves;
  const from = new Date(leaves.getTime() - 48 * 60 * 60 * 1000);
  const dayEnds = new Date(lands.getFullYear(), lands.getMonth(), lands.getDate() + 1);
  return { checkIn: now >= from && now < leaves, status: now >= from && now < dayEnds };
}

// The links for a flight (an entry of kind journey, mode flight) at `now`: null when it is not a flight or its airline is not in
// the list, else { name, checkIn, status, soon: { checkIn, status } } with each address built (null where the airline has none)
// and `soon` saying which belong on the card now. Nothing of the flight goes in an address except, for an entry with a
// `statusLink`, the number's digits and the departure day.
function airlineLinks(item, now, list = AIRLINES) {
  if (!item || item.kind !== 'journey' || item.mode !== 'flight') return null;
  const a = airlineOf(item.number, item.operator, list);
  if (!a) return null;
  let status = a.status || null;
  const digits = /(\d+)[A-Z]?\s*$/i.exec(String(item.number || ''));
  if (a.statusLink && digits && /^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) {
    const built = a.statusLink.replace('{number}', digits[1]).replace('{date}', item.date);
    if (airlineAddressOk(built)) status = built;
  }
  const checkIn = a.checkIn || null;
  if (!checkIn && !status) return null;
  const open = flightWindow(item, now);
  return { name: a.name, checkIn, status, soon: { checkIn: !!checkIn && open.checkIn, status: !!status && open.status } };
}
