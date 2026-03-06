<%*
try {
  const convertSupermemoLink = tp.user.ConvertSupermemoLink;
  tR = convertSupermemoLink(tp);
} catch (error) {
  console.error("Error in ConvertSupermemoLink:", error);
  new Notice("Error: " + error.message);
}
%>
