// Built-in client message templates (client-facing text in English).
// Placeholders: {name} first name, {job} short job description, {amount} quote, {area}, {review} review link, {phone} our phone.

export const REVIEW_URL = "https://g.page/r/Ca_B3XNYnMPwEBM/review";
export const OUR_PHONE = "587-966-9489";

const W =
  "\n\nWarranty & Licensing:\n• 1-Year Craftsmanship Warranty\n• All materials covered by the manufacturer's warranty\n• Fully licensed and insured\n• All building permits & inspections handled by us";
const SIGN = "\n\nBest regards,\nVM Diamond Construction\n" + OUR_PHONE;

export const CATEGORIES = [
  { k: "start", l: "Начало диалога" },
  { k: "price", l: "Цена" },
  { k: "follow", l: "Напоминания" },
  { k: "job", l: "Запись и работа" },
  { k: "after", l: "После работы" },
  { k: "close", l: "Отказ / закрытие" },
  { k: "mail", l: "Рассылка" },
];

export const BUILTIN = [
  {
    id: "first_photos", cat: "start", title: "Первый ответ — попросить фото",
    subject: "Your request — VM Diamond Construction",
    body: "Hello {name},\n\nThank you for contacting VM Diamond Construction regarding {job}. To prepare an accurate price, could you please send a few photos of the area along with approximate dimensions? You may email them to info@vmdiamondconstruction.ca or text them to {phone}.\n\nNew clients receive 10% off their first job (requests by December 31, 2026)." + W + SIGN,
  },
  {
    id: "missed_call", cat: "start", title: "Пропущенный звонок",
    subject: "Sorry we missed your call — VM Diamond Construction",
    body: "Hello, this is VM Diamond Construction. Sorry we missed your call — how can we help? If it is easier, you can send a few photos of the job to info@vmdiamondconstruction.ca or text them to this number, and we will reply with a price." + W + SIGN,
  },
  {
    id: "details", cat: "start", title: "Уточнить детали",
    subject: "A few details about your project",
    body: "Hello {name},\n\nThank you for reaching out regarding {job}. To give you an accurate price, could you please share:\n• a few photos of the area\n• approximate size or measurements\n• your neighbourhood\n• when you would like the work done\n\nYou may send everything to info@vmdiamondconstruction.ca." + W + SIGN,
  },
  {
    id: "visit", cat: "start", title: "Предложить бесплатный выезд",
    subject: "Free on-site estimate",
    body: "Hello {name},\n\nThank you for your request regarding {job}. We would be glad to come by for a free on-site estimate. Would [day] at [time] or [day] at [time] work for you? You may also send any photos or details to info@vmdiamondconstruction.ca." + W + SIGN,
  },
  {
    id: "quote_photos", cat: "price", title: "Цена по фото",
    subject: "Your quote — VM Diamond Construction",
    body: "Hello {name},\n\nThank you for the photos. Based on what we can see, the price for {job} is {amount} + GST, including materials and clean-up. This price already includes your 10% new-client discount.\n\nNo deposit is required — payment is due once the work is completed. If this works for you, please reply with a few days that suit you and we will confirm a time." + W + SIGN,
  },
  {
    id: "quote_visit", cat: "price", title: "Для цены нужен осмотр",
    subject: "Next step for your quote",
    body: "Hello {name},\n\nThank you for the photos. To give you a firm price for {job}, we would need to see the area in person — the estimate visit is free and takes about 15–20 minutes. Would [day] at [time] work for you?" + SIGN,
  },
  {
    id: "follow1", cat: "follow", title: "Напоминание после цены",
    subject: "Following up on your quote",
    body: "Hello {name},\n\nI am following up on the quote we sent for {job}. Please let us know if you have any questions or would like to schedule the work — we would be glad to help." + SIGN,
  },
  {
    id: "follow2", cat: "follow", title: "Последнее напоминание",
    subject: "Checking in one last time",
    body: "Hello {name},\n\nI wanted to check in one last time about {job}. If the timing is not right, that is no problem at all — just let us know and we will keep your quote on file." + SIGN,
  },
  {
    id: "booking", cat: "job", title: "Подтверждение записи",
    subject: "Appointment confirmed",
    body: "Hello {name},\n\nThis is to confirm that our team will arrive on [date] at [time] for {job}. If anything changes, please text us at {phone}." + SIGN,
  },
  {
    id: "on_way", cat: "job", title: "Мы в пути",
    subject: "On our way",
    body: "Hello {name},\n\nOur team is on the way and expects to arrive at about [time]. See you soon." + SIGN,
  },
  {
    id: "done_invoice", cat: "job", title: "Работа завершена + счёт",
    subject: "Work completed — thank you",
    body: "Hello {name},\n\nThank you for having us. The work on {job} is complete. You will receive the invoice from QuickBooks by email shortly, and you can pay online through the link in the invoice. If anything needs attention, please let us know — the work is covered by our 1-year craftsmanship warranty." + SIGN,
  },
  {
    id: "review", cat: "after", title: "Просьба об отзыве",
    subject: "A quick favour — your Google review",
    body: "Hello {name},\n\nThank you for choosing VM Diamond Construction. If you are happy with the work, we would greatly appreciate a short Google review — it helps other homeowners find us:\n{review}\n\nThank you again," + "\nVM Diamond Construction",
  },
  {
    id: "review_thanks", cat: "after", title: "Спасибо за отзыв",
    subject: "Thank you for your review",
    body: "Hello {name},\n\nThank you very much for taking the time to leave a review — we truly appreciate it." + SIGN,
  },
  {
    id: "close_noreply", cat: "close", title: "Не ответил — закрыть",
    subject: "Closing your request",
    body: "Hello {name},\n\nWe have not heard back regarding {job}, so we will close this request for now. If you would like to proceed later, simply reply to this message and we will be happy to help." + SIGN,
  },
  {
    id: "decline", cat: "close", title: "Вежливый отказ",
    subject: "Your request — VM Diamond Construction",
    body: "Hello {name},\n\nThank you for considering VM Diamond Construction. Unfortunately, this type of work is outside the scope of services we currently provide, so we are unable to take it on. We wish you all the best with your project." + SIGN,
  },
  {
    id: "mail_review", cat: "mail", title: "Рассылка: просьба об отзыве",
    subject: "A quick favour — your Google review",
    body: "Hello {name},\n\nThank you again for choosing VM Diamond Construction for {job}. If you were happy with the work, we would greatly appreciate a short Google review — it takes a minute and helps other homeowners find us:\n{review}\n\nThank you,\nVM Diamond Construction",
  },
  {
    id: "mail_checkin", cat: "mail", title: "Рассылка: бывшим клиентам",
    subject: "Anything on your list? — VM Diamond Construction",
    body: "Hello {name},\n\nThis is VM Diamond Construction — we completed {job} for you earlier. We have some availability in the coming weeks for repairs, drywall, painting and small projects. If there is anything on your list, simply reply to this message or text a few photos to {phone}." + SIGN,
  },
];
