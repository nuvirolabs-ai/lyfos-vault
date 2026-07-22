(function () {
  function setStatus(button, message, tone) {
    var targetId = button.getAttribute("data-status-target");
    var target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;
    target.textContent = message || "";
    target.setAttribute("data-tone", tone || "neutral");
  }

  async function postJson(url, payload) {
    var response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || ("Payment request failed (" + response.status + ")"));
    return data;
  }

  async function startCheckout(button) {
    if (!window.Razorpay) throw new Error("Razorpay checkout could not load");

    var amount = Number(button.getAttribute("data-amount"));
    var currency = button.getAttribute("data-currency") || "INR";
    var name = button.getAttribute("data-name") || "Lyfos";
    var description = button.getAttribute("data-description") || "Lyfos paid access";
    var receipt = button.getAttribute("data-receipt") || ("lyfos_" + Date.now());

    if (!Number.isInteger(amount) || amount < 100) throw new Error("Amount must be at least 100 paise");

    button.disabled = true;
    setStatus(button, "Opening secure checkout...", "neutral");

    var order = await postJson("/api/create-order", { amount: amount, currency: currency, receipt: receipt });
    var checkout = new window.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: name,
      description: description,
      order_id: order.order_id,
      handler: async function (response) {
        try {
          await postJson("/api/verify-payment", response);
          setStatus(button, "Payment verified. Access will be activated shortly.", "success");
        } catch (error) {
          setStatus(button, error.message || "Payment verification failed.", "error");
        } finally {
          button.disabled = false;
        }
      },
      modal: {
        ondismiss: function () {
          button.disabled = false;
          setStatus(button, "Checkout closed before payment.", "neutral");
        }
      },
      theme: { color: "#1a9d5a" }
    });

    checkout.on("payment.failed", function (response) {
      button.disabled = false;
      var message = response && response.error && response.error.description
        ? response.error.description
        : "Payment failed. Please try again.";
      setStatus(button, message, "error");
    });

    checkout.open();
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-razorpay-checkout]");
    if (!button) return;
    event.preventDefault();
    startCheckout(button).catch(function (error) {
      button.disabled = false;
      setStatus(button, error.message || "Could not start checkout.", "error");
    });
  });
})();
