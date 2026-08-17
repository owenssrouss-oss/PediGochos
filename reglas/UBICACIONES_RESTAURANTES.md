# 🗺️ REGISTRO INMUTABLE Y MAESTRO DE COORDENADAS GPS (SAN ANTONIO DEL TÁCHIRA)

Este documento contiene el **respaldo maestro e inmutable** de las ubicaciones físicas exactas registradas para los 16 establecimientos de la plataforma DeliverCity / Rapi Gochos.

> [!IMPORTANT]
> **REGLA ABSOLUTA DE SISTEMA:**
> Estas coordenadas representan las ubicaciones reales registradas por el dueño en el mapa. Ningún reinicio de servidor, inicio de sesión de otro usuario, recarga de navegador o sincronización de base de datos puede mover o resetear estas coordenadas a valores nulos o ubicaciones ajenas.

---

## 📍 Tabla Maestra de Coordenadas Inmutables

| # | Establecimiento | ID Único | Slug Normalizado | Latitud GPS | Longitud GPS | Key KDS |
|---|----------------|----------|-------------------|-------------|--------------|---------|
| 1 | **Shawarma Dunes** | `shawarma-dunes-1784412375653` | `shawarmadunes` | `7.815000` | `-72.443800` | `PDXCJX` |
| 2 | **Patacon Fire** | `patacon-fire-1786157840794` | `pataconfire` | `7.815200` | `-72.442800` | `K8QAFC` |
| 3 | **Latinos Burguer** | `latinos-burguer-1786162629597` | `latinosburguer` | `7.816000` | `-72.445000` | `C7IMI6` |
| 4 | **La casa de los batidos** | `la-casa-de-los-batidos-1786157702318` | `lacasadelosbatidos` | `7.814000` | `-72.443000` | `2W3X0T` |
| 5 | **Burger Grill Puente Sucre** | `burger-grill-puente-sucre--1784935634396` | `burgergrillpuentesucre` | `7.817200` | `-72.442500` | `BURGERGRILL` |
| 6 | **Luchos Burguer** | `luchos-burguer-1784912818841` | `luchosburguer` / `luchosburger` | `7.812500` | `-72.444000` | `LUCHOS` |
| 7 | **Sabor Venezolano arepas** | `sabor-venezolano-arepas-1784413922154` | `saborvenezolanoarepas` | `7.814025` | `-72.441775` | `KUTSKZ` |
| 8 | **Míster Cachapa** | `m-ster-cachapa-1785973083758` | `mistercachapa` | `7.814800` | `-72.445500` | `KRS9S3` |
| 9 | **Tanos Resto Bar** | `tanos-resto-bar-1786032587502` | `tanosrestobar` | `7.814500` | `-72.443500` | `AXGTXW` |
| 10 | **Mak Pizza** | `mak-pizza-1784350135697` | `makpizza` | `7.813800` | `-72.442000` | `HP5JBC` |
| 11 | **Karritos De Manuel** | `carritos-de-manuel-1784411690116` | `karritosdemanuel` / `carritosdemanuel` | `7.812800` | `-72.445100` | `8R8I3J` |
| 12 | **Boby Burgers** | `boby-burgers-1784410785941` | `bobyburgers` | `7.814200` | `-72.444500` | `6MAP9F` |
| 13 | **GeMa Pop** | `gema-pop-1785968399832` | `gemapop` | `7.812200` | `-72.443500` | `I0NGPZ` |
| 14 | **FrutyHeladosGourmet** | `frutyheladosgourmet-1786228530112` | `frutyheladosgourmet` | `7.813000` | `-72.442500` | `C7IMI6` |
| 15 | **Boki Arepas** | `boki-arepas-1784927442087` | `bokiarepas` | `7.810803` | `-72.442685` | `BOKIAREPAS` |
| 16 | **Zeus Burger** | `zeus-burger-1786252888630` | `zeusburger` | `7.815445` | `-72.439140` | `91Z7J8` |

---

## 🔒 Mecanismos de Blindaje Implementados en el Código:

1. **Backend (`server.js`):** La función `getImmutableStoreGps(est)` consulta este registro inmutable como fallback y guarda activamente en `store_gps.json` y `db.json`.
2. **Frontend Admin (`admin.js`):** La función `enforceVerifiedGps(establishments)` inyecta estas coordenadas en la tabla del panel y en el mapa global.
3. **Marketplace de Clientes (`marketplace.js`):** `getActiveShopCenter()` usa estas coordenadas para medir la distancia exacta al cliente y calcular el costo de delivery ($5.000 COP base + $1.500 COP por km extra).
4. **Nube (Supabase Storage):** Cada modificación sincroniza automáticamente con `db_backup.json` y `store_gps.json`.
