/** Error esperado por datos de entrada (caso inexistente, JSON malformado, upload vencido): se informa al usuario sin registrarse como fallo. */
export class ErrorDeDatos extends Error {
  override name = 'ErrorDeDatos';
}
