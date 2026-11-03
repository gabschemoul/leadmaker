/** Nom affiché d'un expéditeur : « Prénom Nom · Société ». */
export function senderLabel(sender: {
  first_name: string;
  last_name: string;
  company: string;
}) {
  return `${sender.first_name} ${sender.last_name} · ${sender.company}`;
}
