# Airline links: checklist for a person

For `plan-flight-airline-links.md` step 6. The Itinerary offers **Check in** and **Flight status** for 57 airlines
(`modules/travel/src/travel-lib-airlines.js`). Before release a person opens both addresses of every row, and each must land on
the airline's own check-in or flight-status page. Then set that entry's `checked` to the month (`YYYY-MM`). Until every entry
has one, `node modules/travel/test/check-travel-airlines.mjs --release` fails.

Generated from the list on 2026-11-28, so the addresses here are the ones in the code. If an address is wrong, correct it in
the list, not here. "Status template" says the entry builds its status address from the flight number's digits and the
departure day; for those, also try a real flight number.

| Code | Airline | Check-in address | Flight-status address | Status template | Confirmed (YYYY-MM) |
|---|---|---|---|---|---|
| WN | Southwest Airlines | <https://www.southwest.com/air/check-in/> | <https://www.southwest.com/air/flight-status/> |  | |
| AA | American Airlines | <https://www.aa.com/checkin/viewReservationsAccess> | <https://www.aa.com/travelInformation/flights/status> |  | |
| DL | Delta Air Lines | <https://www.delta.com/us/en/check-in/overview> | <https://www.delta.com/us/en/flight-status> |  | |
| UA | United Airlines | <https://www.united.com/en/us/checkin> | <https://www.united.com/en/us/flightstatus> |  | |
| AS | Alaska Airlines | <https://www.alaskaair.com/checkin> | <https://www.alaskaair.com/flightstatus> |  | |
| B6 | JetBlue Airways | <https://www.jetblue.com/check-in> | <https://www.jetblue.com/flight-status> |  | |
| NK | Spirit Airlines | <https://www.spirit.com/check-in> | <https://www.spirit.com/flight-status> |  | |
| F9 | Frontier Airlines | <https://www.flyfrontier.com/travel/travel-info/check-in/> | <https://www.flyfrontier.com/travel/flight-status/> |  | |
| G4 | Allegiant Air | <https://www.allegiantair.com/check-in> | <https://www.allegiantair.com/flight-status> |  | |
| HA | Hawaiian Airlines | <https://www.hawaiianairlines.com/check-in> | <https://www.hawaiianairlines.com/flight-status> |  | |
| AC | Air Canada | <https://www.aircanada.com/ca/en/aco/home/book/check-in.html> | <https://www.aircanada.com/ca/en/aco/home/book/flight-status.html> |  | |
| WS | WestJet | <https://www.westjet.com/en-ca/check-in> | <https://www.westjet.com/en-ca/flight-status> |  | |
| BA | British Airways | <https://www.britishairways.com/travel/olcilandingpageauthreq/public/en_gb> | <https://www.britishairways.com/travel/flightinformation/public/en_gb> |  | |
| VS | Virgin Atlantic | <https://www.virginatlantic.com/check-in> | <https://www.virginatlantic.com/flight-status> |  | |
| LH | Lufthansa | <https://www.lufthansa.com/xx/en/online-check-in> | <https://www.lufthansa.com/xx/en/flight-status> |  | |
| AF | Air France | <https://wwws.airfrance.com/check-in> | <https://www.airfrance.com/en/flight-status> |  | |
| KL | KLM Royal Dutch Airlines | <https://www.klm.com/check-in> | <https://www.klm.com/flight-status> |  | |
| IB | Iberia | <https://www.iberia.com/us/check-in/> | <https://www.iberia.com/us/flight-status/> |  | |
| VY | Vueling | <https://www.vueling.com/en/vueling-services/check-in> | <https://www.vueling.com/en/vueling-services/flight-status> |  | |
| FR | Ryanair | <https://www.ryanair.com/gb/en/check-in> | <https://www.ryanair.com/gb/en/flight-status> |  | |
| U2 | easyJet | <https://www.easyjet.com/en/check-in> | <https://www.easyjet.com/en/flight-tracker> |  | |
| W6 | Wizz Air | <https://www.wizzair.com/en-gb/booking/check-in> | <https://www.wizzair.com/en-gb/flights/flight-status> |  | |
| DY | Norwegian | <https://www.norwegian.com/en/check-in/> | <https://www.norwegian.com/en/flight-status/> |  | |
| TP | TAP Air Portugal | <https://www.flytap.com/en-us/check-in> | <https://www.flytap.com/en-us/flight-status> |  | |
| LX | Swiss International Air Lines | <https://www.swiss.com/us/en/prepare/check-in> | <https://www.swiss.com/us/en/prepare/flight-status> |  | |
| OS | Austrian Airlines | <https://www.austrian.com/us/en/check-in> | <https://www.austrian.com/us/en/flight-status> |  | |
| SK | Scandinavian Airlines | <https://www.flysas.com/en/check-in/> | <https://www.flysas.com/en/flight-status/> |  | |
| AY | Finnair | <https://www.finnair.com/en/check-in> | <https://www.finnair.com/en/flight-status> |  | |
| EI | Aer Lingus | <https://www.aerlingus.com/check-in/> | <https://www.aerlingus.com/travel-information/flight-status/> |  | |
| TK | Turkish Airlines | <https://www.turkishairlines.com/en-int/flights/check-in/> | <https://www.turkishairlines.com/en-int/flights/flight-status/> |  | |
| EK | Emirates | <https://www.emirates.com/english/manage-booking/online-check-in/> | <https://www.emirates.com/english/manage-booking/flight-status/> |  | |
| QR | Qatar Airways | <https://www.qatarairways.com/en/check-in.html> | <https://www.qatarairways.com/en/flight-status.html> |  | |
| EY | Etihad Airways | <https://www.etihad.com/en/manage/check-in> | <https://www.etihad.com/en/manage/flight-status> |  | |
| SV | Saudia | <https://www.saudia.com/before-flying/check-in> | <https://www.saudia.com/before-flying/flight-status> |  | |
| ET | Ethiopian Airlines | <https://www.ethiopianairlines.com/aa/check-in> | <https://www.ethiopianairlines.com/aa/flight-status> |  | |
| KQ | Kenya Airways | <https://www.kenya-airways.com/check-in> | <https://www.kenya-airways.com/flight-status> |  | |
| SQ | Singapore Airlines | <https://www.singaporeair.com/en_UK/us/plan-travel/check-in/> | <https://www.singaporeair.com/en_UK/us/flightinformation/flight-status/> |  | |
| CX | Cathay Pacific | <https://www.cathaypacific.com/cx/en_US/manage-booking/check-in.html> | <https://www.cathaypacific.com/cx/en_US/flight-info/flight-status.html> |  | |
| QF | Qantas | <https://www.qantas.com/au/en/travel-info/check-in.html> | <https://www.qantas.com/au/en/travel-info/flight-status.html> |  | |
| NZ | Air New Zealand | <https://www.airnewzealand.com/check-in> | <https://www.airnewzealand.com/flight-status> |  | |
| JL | Japan Airlines | <https://www.jal.co.jp/en/inter/checkin/> | <https://www.jal.co.jp/en/inter/flight-status/> |  | |
| NH | All Nippon Airways | <https://www.ana.co.jp/en/us/book-plan/check-in/> | <https://www.ana.co.jp/en/us/book-plan/status/> |  | |
| KE | Korean Air | <https://www.koreanair.com/check-in> | <https://www.koreanair.com/flight-status> |  | |
| CI | China Airlines | <https://www.china-airlines.com/us/en/booking/check-in> | <https://www.china-airlines.com/us/en/flights/flight-status> |  | |
| BR | EVA Air | <https://www.evaair.com/en-global/manage-my-trip/check-in/> | <https://www.evaair.com/en-global/flight-information/flight-status/> |  | |
| AI | Air India | <https://www.airindia.com/in/en/manage/web-check-in.html> | <https://www.airindia.com/in/en/manage/flight-status.html> |  | |
| 6E | IndiGo | <https://www.goindigo.in/web-check-in.html> | <https://www.goindigo.in/flight-status.html> |  | |
| AK | AirAsia | <https://www.airasia.com/check-in/en/gb> | <https://www.airasia.com/flight-status/en/gb> |  | |
| MH | Malaysia Airlines | <https://www.malaysiaairlines.com/my/en/manage-booking/check-in.html> | <https://www.malaysiaairlines.com/my/en/flight-status.html> |  | |
| TG | Thai Airways | <https://www.thaiairways.com/en/manage_booking/online_check_in.page> | <https://www.thaiairways.com/en/flight_status/flight_status.page> |  | |
| LA | LATAM Airlines | <https://www.latamairlines.com/us/en/check-in> | <https://www.latamairlines.com/us/en/flight-status> |  | |
| AV | Avianca | <https://www.avianca.com/us/en/prepare-for-your-trip/check-in/> | <https://www.avianca.com/us/en/prepare-for-your-trip/flight-status/> |  | |
| CM | Copa Airlines | <https://www.copaair.com/en-us/web-check-in/> | <https://www.copaair.com/en-us/flight-status/> |  | |
| AM | Aeromexico | <https://aeromexico.com/en-us/check-in> | <https://aeromexico.com/en-us/flight-status> |  | |
| Y4 | Volaris | <https://www.volaris.com/check-in> | <https://www.volaris.com/flight-status> |  | |
| G3 | GOL Linhas Aereas | <https://www.voegol.com.br/en/check-in> | <https://www.voegol.com.br/en/flight-status> |  | |
| AD | Azul Brazilian Airlines | <https://www.voeazul.com.br/us/en/check-in> | <https://www.voeazul.com.br/us/en/flight-status> |  | |
