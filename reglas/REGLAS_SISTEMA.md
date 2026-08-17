# 📜 REGLAS OBLIGATORIAS DEL SISTEMA (RAPI GOCHOS)

> **AVISO CRÍTICO PARA EL ASISTENTE Y DESARROLLADORES:**
> Este documento contiene las reglas inviolables del sistema. Debes consultar y respetar estas reglas antes de ejecutar cualquier cambio o comando.

---

## 📍 REGLA 1: INMUTABILIDAD Y PROTECCIÓN TOTAL DEL GPS DE RESTAURANTES
1. **Coordenadas Inmutables y Fijas:**
   - Todos los 16 establecimientos tienen coordenadas GPS verificadas en el casco urbano de San Antonio del Táchira.
   - **Bajo ninguna circunstancia** se deben restablecer, poner en `null`, en `0`, o borrar las coordenadas de los restaurantes.
   - Todo flujo de lectura (`readDB`), sincronización (`syncFromSupabase`, `syncFromPostgres`), escritura (`writeDB`) o inicio de sesión en cualquier dispositivo debe ejecutar automáticamente `getImmutableStoreGps` para garantizar que cada restaurante mantenga sus coordenadas maestras.
   - Consulta el registro oficial en [`reglas/UBICACIONES_RESTAURANTES.md`](./UBICACIONES_RESTAURANTES.md).

---

## ☁️ REGLA 2: FUENTE ÚNICA DE VERDAD EN LA NUBE (SUPABASE STORAGE)
1. **Memoria Maestra Centralizada:**
   - El archivo `db_backup.json` (junto con `disabled_stores.json` y `store_gps.json`) en Supabase Storage es la **fuente de verdad absoluta y completa**.
   - Contiene la totalidad de los comercios (16 locales), sus cartas completas con todos sus productos, categorías, adicionales, horarios de apertura/cierre y llaves de acceso (`linkKey`).
   - Los datos **nunca** deben ser sobrescritos por plantillas de prueba o datos incompletos de esquemas relacionales parciales.

---

## 🔒 REGLA 3: SESIÓN DE ADMINISTRADOR INMORTAL Y PANTALLA ACTIVA
1. **Persistencia Permanente:**
   - La sesión del panel de administrador (`/admin.html`) **nunca debe expirar ni cerrarse automáticamente** por inactividad o fallos temporales de red.
   - Utiliza `localStorage.setItem('owner_authenticated_permanently', 'true')` y `Screen Wake Lock API` (`navigator.wakeLock`) para mantener la pantalla permanentemente encendida en el mostrador.
   - El botón de cierre de sesión debe requerir confirmación explícita para evitar pérdida involuntaria de alertas.

---

## 🚨 REGLA 4: ALARMA SONORA ESCANDALOSA DE 20 SEGUNDOS
1. **Sonido Continuo y Notificación Inmediata:**
   - Todo nuevo pedido entrante en Cocina (`kitchen.html`) o en el Panel de Administrador (`admin.html`) debe reproducir la alarma continua de **20 segundos** (`Sound.startPersistentOrderAlarm(20)`).
   - Debe mostrar el banner superior rojo destellante con botón de silenciado.
   - La alarma se apaga inmediatamente al interactuar con la pantalla, abrir la app o enfocar la pestaña.
