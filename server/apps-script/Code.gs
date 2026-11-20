/**
 * Recibe los pre registros desde el servidor de la landing y los guarda en la hoja.
 *
 * Instalación:
 * 1. Crea una hoja de cálculo nueva en Google Sheets (privada) y abre Extensiones > Apps Script.
 * 2. Pega este código.
 * 3. Configuración del proyecto (engranaje) > Propiedades del script > agrega:
 *      SECRET = (una clave larga inventada por ti; la misma que SHEETS_WEBHOOK_SECRET en Easy Panel)
 * 4. Implementar > Nueva implementación > Aplicación web.
 *      Ejecutar como: Yo.   Quién tiene acceso: Cualquier persona.
 * 5. Copia la URL que termina en /exec y ponla en SHEETS_WEBHOOK_URL (Easy Panel).
 *
 * Cada fila queda con su cupón (Q25 o Q15) y pintada de color para verlo de un vistazo.
 */
var SHEET_NAME = 'Pre registros';
var HEADERS = ['Fecha', 'Posición', 'Cupón', 'Nombre', 'Apellido', 'Teléfono', 'Correo', 'Acepta correos'];
var COLORS = { 'Q25': '#dcfce7', 'Q15': '#e9ddff', 'Sin cupón': '#f3f4f6' };

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.secret !== PropertiesService.getScriptProperties().getProperty('SECRET')) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    var sheet = getSheet_();

    // Evita duplicados por correo (por si el servidor reintenta).
    var emails = sheet.getRange(2, 7, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i][0]).toLowerCase() === String(data.correo).toLowerCase()) {
        return json_({ ok: true, duplicate: true });
      }
    }

    var fecha = Utilities.formatDate(new Date(data.fecha), 'America/Guatemala', 'yyyy-MM-dd HH:mm:ss');
    var row = [fecha, data.posicion, data.cupon, data.nombre, data.apellido, "'" + data.telefono,
               data.correo, data.aceptaCorreos];
    sheet.appendRow(row);
    var last = sheet.getLastRow();
    sheet.getRange(last, 3).setBackground(COLORS[data.cupon] || '#ffffff').setFontWeight('bold');
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#6d3bd1').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, HEADERS.length, 130);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
