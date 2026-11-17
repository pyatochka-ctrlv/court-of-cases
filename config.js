/* Необов'язкове налаштування «режиму кімнати» для пульта на телефоні.
   Якщо залишити порожнім — пульт працює лише в тому самому браузері (сусідня вкладка/вікно).
   Щоб увімкнути: створіть Firebase Realtime Database і вставте її адресу, напр.
   "https://sud-papky-default-rtdb.europe-west1.firebasedatabase.app"
   Правила бази — у README.md. */
window.SUD_CONFIG = {
  firebaseDatabaseURL: ""
};
