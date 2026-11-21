// The fixed answer of host.ai.extract that the paste sheet's checks read (the stand-in model's scripted answer, in the shape
// server/ai-extract.js sends: { objects, notes, unread, dropped, cut, tokens }). Three bookings, the second with a note.
// Not a check: it only exports, so check-module-tests runs it as a script that exits 0.
export const ANSWER = {
  objects: [
    { icon: 'plane', kind: 'flight', title: 'TP 1350 Lisbon to London', date: '2027-03-14', details: { airline: 'TAP Air Portugal', number: 'TP 1350', from: { code: 'LIS', name: 'Lisbon' }, to: { code: 'LHR', name: 'London Heathrow' }, departs: '2027-03-14T07:05', arrives: '2027-03-14T09:50', reference: 'QX7RTB', cost: 412.8, currency: 'EUR', travellers: ['Ana Silva'] } },
    { icon: 'bed', kind: 'hotel', title: 'The Zetter Townhouse', date: '2027-03-14', details: { address: '49 Bayswater Road, London', checkIn: '2027-03-14T15:00', checkOut: '2027-03-17T11:00', roomType: 'Double', guests: 2, cost: 540, currency: 'GBP' } },
    { icon: 'utensils', kind: 'restaurant', title: 'Dinner at Padella', date: '2027-03-15', details: { starts: '2027-03-15T19:30', partySize: 2, name: 'Silva' } },
  ],
  notes: [[], ['The confirmation number was not in the text, so it is left blank.'], []],
  unread: ['A line about a loyalty card was not a booking.'],
  dropped: 0,
  cut: false,
  tokens: 910,
};
export const TEXT = 'Your booking QX7RTB is confirmed. TAP Air Portugal TP 1350, Lisbon (LIS) 07:05 to London Heathrow (LHR) 09:50, 14 Mar 2027. Passenger: Ana Silva. Total 412.80 EUR.\nHotel: The Zetter Townhouse, check in 14 Mar from 15:00, check out 17 Mar 11:00, double room, 2 guests, GBP 540.\nDinner at Padella, 15 Mar 19:30, table for 2 under Silva.';
if (import.meta.url === `file://${process.argv[1]}`) process.exit(0);
