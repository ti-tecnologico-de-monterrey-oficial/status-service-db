// @digitalcredentials/bnid declara react-native-securerandom como dependencia,
// pero solo lo importa en su build de React Native; en Node genera los bytes
// con node:crypto. Este sustituto evita instalar react-native y metro, que el
// paquete real arrastra como peer.
function generateSecureRandom () {
  throw new Error('react-native-securerandom solo está disponible en React Native.');
}

module.exports = { generateSecureRandom };
