# 🗺️ REGISTRO INMUTABLE DE COORDENADAS GPS (SAN ANTONIO DEL TÁCHIRA)

Este documento define la tabla maestra de coordenadas GPS de los 16 establecimientos de la plataforma DeliverCity / Rapi Gochos. Estas coordenadas están grabadas de forma inmutable tanto en el backend (`server.js`) como en la base de datos (`store_gps.json` y `db.json`) y en el frontend (`admin.js` y `marketplace.js`).

---

| # | Establecimiento | ID Único | Slug Normalizado | Latitud GPS | Longitud GPS | Key |
|---|----------------|----------|-------------------|-------------|--------------|-----|
| 1 | **Shawarma Dunes** | `shawarma-dunes-1784412375653` | `shawarmadunes` | `7.8150` | `-72.4438` | `PDXCJX` |
| 2 | **La casa de los batidos** | `la-casa-de-los-batidos-1786157702318` | `lacasadelosbatidos` | `7.8140` | `-72.4430` | `2W3X0T` |
| 3 | **Patacon Fire** | `patacon-fire-1786157840794` | `pataconfire` | `7.8152` | `-72.4428` | `K8QAFC` |
| 4 | **Latinos Burguer** | `latinos-burguer-1786162629597` | `latinosburguer` | `7.8160` | `-72.4450` | `C7IMI6` |
| 5 | **Mak Pizza** | `mak-pizza-1784350135697` | `makpizza` | `7.8138` | `-72.4420` | `HP5JBC` |
| 6 | **Míster Cachapa** | `m-ster-cachapa-1785973083758` | `mistercachapa` | `7.8148` | `-72.4455` | `KRS9S3` |
| 7 | **Tanos Resto Bar** | `tanos-resto-bar-1786032587502` | `tanosrestobar` | `7.8145` | `-72.4435` | `AXGTXW` |
| 8 | **Sabor Venezolano arepas** | `sabor-venezolano-arepas-1784413922154` | `saborvenezolanoarepas` | `7.8135` | `-72.4432` | `KUTSKZ` |
| 9 | **Muchos Burguer (Luchos)** | `muchos-burguer-1784912818841` | `muchosburguer` / `luchosburger` | `7.8125` | `-72.4440` | `MUCHOS` |
| 10 | **Karritos De Manuel** | `carritos-de-manuel-1784411690116` | `karritosdemanuel` / `carritosdemanuel` | `7.8128` | `-72.4451` | `8R8I3J` |
| 11 | **Burger Grill Puente Sucre** | `burger-grill-puente-sucre--1784935634396` | `burgergrillpuentesucre` | `7.8172` | `-72.4425` | `BURGERGRILL` |
| 12 | **Boby Burgers** | `boby-burgers-1784410785941` | `bobyburgers` | `7.8142` | `-72.4445` | `6MAP9F` |
| 13 | **GeMa Pop** | `gema-pop-1785968399832` | `gemapop` | `7.8122` | `-72.4435` | `I0NGPZ` |
| 14 | **FrutyHeladosGourmet** | `frutyheladosgourmet-1786228530112` | `frutyheladosgourmet` | `7.8130` | `-72.4425` | `C7IMI6` |
| 15 | **Boki Arepas** | `boki-arepas-1784927442087` | `bokiarepas` | `7.8155` | `-72.4440` | `BOKIAREPAS` |
| 16 | **Zeus Burger** | `zeus-burger-1786252888630` | `zeusburger` | `7.8158` | `-72.4430` | `91Z7J8` |

---

### Regla Técnica de Preservación:
Si en algún momento una llamada a base de datos devuelve un valor nulo, la función `getImmutableStoreGps` inyecta automáticamente estas coordenadas predeterminadas antes de servir o guardar la información.
