# Airline links: checklist for a person

For `plan-flight-airline-links.md` step 6. The Itinerary offers **Check in** and **Flight status** for 56 airlines
(`modules/travel/src/travel-lib-airlines.js`). Before release a person opens both addresses of every row, and each must land on
the airline's own check-in or flight-status page. Then set that entry's `checked` to the month (`YYYY-MM`). Until every entry
has one, `node modules/travel/test/check-travel-airlines.mjs --release` fails.

Generated from the list on 2026-11-28, after the addresses were corrected, so these are the addresses in the code. If an address
is wrong, correct it in the list, not here. "none" means no flight-status link is offered (no public page was found).

| Code | Airline | Check-in address | Flight-status address | Confirmed (YYYY-MM) |
|---|---|---|---|---|
| WN | Southwest Airlines | <https://www.southwest.com/air/check-in/> | <https://www.southwest.com/air/flight-status/> | |
| AA | American Airlines | <https://www.aa.com/homePage.do#aa-viewReservations> | <https://www.aa.com/travelInformation/flights/status> | |
| DL | Delta Air Lines | <https://www.delta.com/us/en/check-in-security/overview> | <https://www.delta.com/flightstatus/search> | |
| UA | United Airlines | <https://www.united.com/en/us/checkin> | <https://www.united.com/en/us/flightstatus> | |
| AS | Alaska Airlines | <https://reservations.alaskaair.com/checkin> | <https://www.alaskaair.com/flightstatus> | |
| B6 | JetBlue Airways | <https://www.jetblue.com/help/checking-in/check-in-online> | <https://www.jetblue.com/flight-tracker-and-status> | |
| F9 | Frontier Airlines | <https://www.flyfrontier.com/travel/my-trips/check-in/> | <https://booking.flyfrontier.com/Flight/Status> | |
| G4 | Allegiant Air | <https://www.allegiantair.com/check-in> | <https://www.allegiantair.com/flight-status> | |
| HA | Hawaiian Airlines | <https://www.hawaiianairlines.com/content/ha/travel-info/at-the-airport/airport-check-in-options> | none | |
| AC | Air Canada | <https://www.aircanada.com/ca/en/aco/home/book/check-in.html> | <https://www.aircanada.com/us/en/aco/home/fly/flight-information.html> | |
| WS | WestJet | <https://www.westjet.com/en-us/manage/check-in> | <https://www.westjet.com/en-us/flights/status> | |
| BA | British Airways | <https://www.britishairways.com/travel/olcilandingpageauthreq/public/en_gb> | <https://www.britishairways.com/travel/flightinformation/public/en_gb> | |
| VS | Virgin Atlantic | <https://www.virginatlantic.com/PCCOciWeb/findBy> | <https://www.virginatlantic.com/flightinfo/viewFlightStatusByOrigin> | |
| LH | Lufthansa | <https://www.lufthansa.com/xx/en/online-check-in> | <https://www.lufthansa.com/xx/en/flight-status> | |
| AF | Air France | <https://wwws.airfrance.us/check-in> | <https://wwws.airfrance.us/flight-status> | |
| KL | KLM Royal Dutch Airlines | <https://www.klm.com/check-in> | <https://www.klm.com/flight-status> | |
| IB | Iberia | <https://www.iberia.com/us/check-in/> | <https://www.iberia.com/us/flight-status/> | |
| VY | Vueling | <https://www.vueling.com/en/vueling-services/check-in> | <https://www.vueling.com/en/vueling-services/flight-status> | |
| FR | Ryanair | <https://www.ryanair.com/gb/en/lp/check-in> | none | |
| U2 | easyJet | <https://www.easyjet.com/en/help/booking-and-check-in/check-in> | <https://www.easyjet.com/en/flight-tracker> | |
| W6 | Wizz Air | <https://www.wizzair.com/en-gb/booking/check-in> | <https://www.wizzair.com/en-gb/flights/flight-status> | |
| DY | Norwegian | <https://www.norwegian.com/en/check-in/> | <https://www.norwegian.com/en/flight-status/> | |
| TP | TAP Air Portugal | <https://www.flytap.com/en-us/check-in-information> | <https://www.flytap.com/en-us/tools/flight-information-tool> | |
| LX | Swiss International Air Lines | <https://www.swiss.com/us/en/prepare/check-in> | <https://www.swiss.com/us/en/prepare/flight-status> | |
| OS | Austrian Airlines | <https://www.austrian.com/us/en/check-in> | <https://www.austrian.com/us/en/flight-status> | |
| SK | Scandinavian Airlines | <https://www.flysas.com/en/check-in/> | <https://www.flysas.com/en/flight-status/> | |
| AY | Finnair | <https://www.finnair.com/en/check-in> | <https://www.finnair.com/en/flight-status> | |
| EI | Aer Lingus | <https://www.aerlingus.com/check-in/> | <https://www.aerlingus.com/travel-information/flight-status/> | |
| TK | Turkish Airlines | <https://www.turkishairlines.com/en-int/flights/check-in/> | <https://www.turkishairlines.com/en-int/flights/flight-status/> | |
| EK | Emirates | <https://www.emirates.com/english/manage-booking/online-check-in/> | <https://www.emirates.com/english/manage-booking/flight-status/> | |
| QR | Qatar Airways | <https://www.qatarairways.com/en/check-in.html> | <https://www.qatarairways.com/en/flight-status.html> | |
| EY | Etihad Airways | <https://www.etihad.com/en/manage/check-in> | <https://www.etihad.com/en/manage/flight-status> | |
| SV | Saudia | <https://www.saudia.com/before-flying/check-in> | <https://www.saudia.com/before-flying/flight-status> | |
| ET | Ethiopian Airlines | <https://www.ethiopianairlines.com/us/book/check-in/web-check-in> | <https://www.ethiopianairlines.com/et/book/booking/flight-status> | |
| KQ | Kenya Airways | <https://www.kenya-airways.com/en/book-manage/post-booking/check-in/> | <https://www.kenya-airways.com/en/book-manage/flight-status/> | |
| SQ | Singapore Airlines | <https://www.singaporeair.com/en_UK/us/travel-info/check-in/> | none | |
| CX | Cathay Pacific | <https://www.cathaypacific.com/mb/> | <https://www.cathaypacific.com/cx/en_US/prepare-trip/flight-status.html> | |
| QF | Qantas | <https://www.qantas.com/en-au/manage-booking/check-in> | <https://www.qantas.com/en-au/travel-information/flight-status> | |
| NZ | Air New Zealand | <https://www.airnewzealand.com/en-nz/online-check-in> | <https://www.airnewzealand.com/en-nz/travel-info/arrivals-and-departures> | |
| JL | Japan Airlines | <https://www.jal.co.jp/en/inter/checkin/> | <https://www.jal.co.jp/en/inter/flight-status/> | |
| NH | All Nippon Airways | <https://www.ana.co.jp/en/us/guide/boarding-procedures/checkin/online-checkin/> | none | |
| KE | Korean Air | <https://www.koreanair.com/check-in> | <https://www.koreanair.com/flight-status> | |
| CI | China Airlines | <https://www.china-airlines.com/us/en/booking/check-in> | <https://www.china-airlines.com/us/en/flights/flight-status> | |
| BR | EVA Air | <https://www.evaair.com/en-global/manage-my-trip/check-in/> | <https://www.evaair.com/en-global/flight-information/flight-status/> | |
| AI | Air India | <https://www.airindia.com/in/en/manage/web-check-in.html> | <https://www.airindia.com/in/en/manage/flight-status.html> | |
| 6E | IndiGo | <https://www.goindigo.in/web-check-in.html> | <https://www.goindigo.in/flight-status.html> | |
| AK | AirAsia | <https://www.airasia.com/check-in/en/gb> | <https://www.airasia.com/flightstatus/en/gb> | |
| MH | Malaysia Airlines | <https://www.malaysiaairlines.com/us/en/travel-info/check-in.html> | none | |
| TG | Thai Airways | <https://www.thaiairways.com/en-us/content/check-in/> | <https://www.thaiairways.com/en-th/book/flight-status/> | |
| LA | LATAM Airlines | <https://www.latamairlines.com/us/en/check-in> | <https://www.latamairlines.com/us/en/flight-status> | |
| AV | Avianca | <https://www.avianca.com/us/en/prepare-for-your-trip/check-in/> | <https://www.avianca.com/us/en/prepare-for-your-trip/flight-status/> | |
| CM | Copa Airlines | <https://www.copaair.com/en-us/web-check-in/> | <https://www.copaair.com/en-us/flight-status/> | |
| AM | Aeromexico | <https://aeromexico.com/en-us/check-in> | <https://aeromexico.com/en-us/flight-status> | |
| Y4 | Volaris | <https://www.volaris.com/check-in> | <https://www.volaris.com/flight-status> | |
| G3 | GOL Linhas Aereas | <https://www.voegol.com.br/en/informacoes/como-fazer-check-in> | <https://www.voegol.com.br/en/informacoes> | |
| AD | Azul Brazilian Airlines | <https://www.voeazul.com.br/us/en/check-in> | <https://www.voeazul.com.br/us/en/flight-status> | |
