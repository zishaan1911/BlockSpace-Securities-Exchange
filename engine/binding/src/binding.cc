// N-API binding for gasx::EngineService.
//
// The protocol module (engine/include/gasx/protocol/) was written for
// exactly this: plain request/response structs with no serialization,
// because N-API marshals fields directly between JS and C++ rather than
// going through a wire format. This file is the 1:1 wrapper that header
// anticipated.
//
// What the engine is used for here matters. contracts/gasx already owns
// the authoritative order book, matching and margin on-chain, and this
// binding does not replace any of that — settlement remains on Sui.
// What Sui cannot do cheaply is answer "what does the book look like
// right now" and "what two-sided quote should we show" on every UI
// poll, because each would be a chain read. So the engine runs as an
// off-chain quote and depth layer beside the chain, not instead of it.
#include <napi.h>

#include <string>

#include "gasx/protocol/engine_service.hpp"

namespace {

// Reads a numeric field, tolerating the JS habit of passing numbers as
// strings, and defaulting rather than throwing when absent.
std::int64_t GetInt(const Napi::Object& obj, const char* key, std::int64_t fallback = 0) {
  if (!obj.Has(key)) return fallback;
  Napi::Value value = obj.Get(key);
  if (value.IsNumber()) return value.As<Napi::Number>().Int64Value();
  if (value.IsString()) return std::stoll(value.As<Napi::String>().Utf8Value());
  return fallback;
}

double GetDouble(const Napi::Object& obj, const char* key, double fallback = 0.0) {
  if (!obj.Has(key)) return fallback;
  Napi::Value value = obj.Get(key);
  return value.IsNumber() ? value.As<Napi::Number>().DoubleValue() : fallback;
}

std::string GetString(const Napi::Object& obj, const char* key, const std::string& fallback = "") {
  if (!obj.Has(key)) return fallback;
  Napi::Value value = obj.Get(key);
  return value.IsString() ? value.As<Napi::String>().Utf8Value() : fallback;
}

bool GetBool(const Napi::Object& obj, const char* key, bool fallback = false) {
  if (!obj.Has(key)) return fallback;
  Napi::Value value = obj.Get(key);
  return value.IsBoolean() ? value.As<Napi::Boolean>().Value() : fallback;
}

Napi::Object FillToJs(Napi::Env env, const gasx::Fill& fill) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("price", Napi::Number::New(env, static_cast<double>(fill.price)));
  out.Set("quantity", Napi::Number::New(env, static_cast<double>(fill.quantity)));
  out.Set("restingTraderId", Napi::String::New(env, fill.resting_trader_id));
  out.Set("incomingTraderId", Napi::String::New(env, fill.incoming_trader_id));
  out.Set("incomingSide", Napi::String::New(env, fill.incoming_side == gasx::Side::Buy ? "BUY" : "SELL"));
  return out;
}

}  // namespace

// Wraps one EngineService instance. One instance is one market, matching
// the C++ class's own contract.
class EngineWrapper : public Napi::ObjectWrap<EngineWrapper> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Engine", {
      InstanceMethod("placeOrder", &EngineWrapper::PlaceOrder),
      InstanceMethod("cancelOrder", &EngineWrapper::CancelOrder),
      InstanceMethod("getQuote", &EngineWrapper::GetQuote),
      InstanceMethod("getBookSnapshot", &EngineWrapper::GetBookSnapshot),
      InstanceMethod("netPosition", &EngineWrapper::NetPosition),
    });
    exports.Set("Engine", func);
    return exports;
  }

  explicit EngineWrapper(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<EngineWrapper>(info) {
    Napi::Env env = info.Env();
    Napi::Object options = info.Length() > 0 && info[0].IsObject()
                               ? info[0].As<Napi::Object>()
                               : Napi::Object::New(env);

    gasx::RiskLimits limits;
    if (options.Has("risk") && options.Get("risk").IsObject()) {
      Napi::Object risk = options.Get("risk").As<Napi::Object>();
      limits.contract_multiplier = GetInt(risk, "contractMultiplier", limits.contract_multiplier);
      limits.margin_ratio_bps = GetInt(risk, "marginRatioBps", limits.margin_ratio_bps);
      limits.max_order_quantity = GetInt(risk, "maxOrderQuantity", limits.max_order_quantity);
      limits.max_net_position = GetInt(risk, "maxNetPosition", limits.max_net_position);
    }

    gasx::PricingConfig pricing;
    if (options.Has("pricing") && options.Get("pricing").IsObject()) {
      Napi::Object p = options.Get("pricing").As<Napi::Object>();
      pricing.price_scale = GetInt(p, "priceScale", pricing.price_scale);
      pricing.base_half_spread = GetInt(p, "baseHalfSpread", pricing.base_half_spread);
      pricing.volatility_spread_multiplier =
          GetDouble(p, "volatilitySpreadMultiplier", pricing.volatility_spread_multiplier);
      pricing.min_confidence = GetDouble(p, "minConfidence", pricing.min_confidence);
      pricing.max_quote_size = GetInt(p, "maxQuoteSize", pricing.max_quote_size);
      pricing.min_quote_size = GetInt(p, "minQuoteSize", pricing.min_quote_size);
      pricing.inventory_skew_per_unit =
          GetInt(p, "inventorySkewPerUnit", pricing.inventory_skew_per_unit);
    }

    engine_ = std::make_unique<gasx::EngineService>(limits, pricing);
  }

 private:
  std::unique_ptr<gasx::EngineService> engine_;

  Napi::Value PlaceOrder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
      throw Napi::TypeError::New(env, "placeOrder expects an object");
    }
    Napi::Object arg = info[0].As<Napi::Object>();

    gasx::protocol::PlaceOrderRequest request;
    request.trader_id = GetString(arg, "traderId");
    request.side = GetBool(arg, "isBid") ? gasx::Side::Buy : gasx::Side::Sell;
    request.price = GetInt(arg, "price");
    request.quantity = GetInt(arg, "quantity");
    request.available_margin = GetInt(arg, "availableMargin");

    auto response = engine_->place_order(request);

    Napi::Object out = Napi::Object::New(env);
    const bool accepted = response.status == gasx::protocol::PlaceOrderStatus::Accepted;
    out.Set("accepted", Napi::Boolean::New(env, accepted));
    out.Set("orderId", Napi::Number::New(env, static_cast<double>(response.order_id)));
    out.Set("rejectReason", Napi::String::New(env, response.reject_reason));

    Napi::Array fills = Napi::Array::New(env, response.fills.size());
    for (size_t i = 0; i < response.fills.size(); ++i) {
      fills.Set(i, FillToJs(env, response.fills[i]));
    }
    out.Set("fills", fills);
    return out;
  }

  Napi::Value CancelOrder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    gasx::protocol::CancelOrderRequest request;
    request.order_id = info.Length() > 0 ? info[0].As<Napi::Number>().Int64Value() : 0;
    auto response = engine_->cancel_order(request);
    Napi::Object out = Napi::Object::New(env);
    out.Set("cancelled", Napi::Boolean::New(env, response.cancelled));
    return out;
  }

  Napi::Value GetQuote(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
      throw Napi::TypeError::New(env, "getQuote expects an object");
    }
    Napi::Object arg = info[0].As<Napi::Object>();

    gasx::protocol::GetQuoteRequest request;
    request.model_input.market = GetString(arg, "market", "EGSI-1H");
    request.model_input.expected_value = GetDouble(arg, "expectedValue");
    request.model_input.volatility = GetDouble(arg, "volatility");
    request.model_input.confidence = GetDouble(arg, "confidence");
    request.model_input.tail_probability = GetDouble(arg, "tailProbability");
    request.model_input.model_version = GetString(arg, "modelVersion", "");
    request.net_position = GetInt(arg, "netPosition");

    auto response = engine_->get_quote(request);

    Napi::Object out = Napi::Object::New(env);
    out.Set("hasQuote", Napi::Boolean::New(env, response.has_quote));
    if (response.has_quote) {
      out.Set("bid", Napi::Number::New(env, static_cast<double>(response.quote.bid)));
      out.Set("ask", Napi::Number::New(env, static_cast<double>(response.quote.ask)));
      out.Set("fairPrice", Napi::Number::New(env, static_cast<double>(response.quote.fair_price)));
      out.Set("size", Napi::Number::New(env, static_cast<double>(response.quote.quote_size)));
    }
    return out;
  }

  Napi::Value GetBookSnapshot(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto response = engine_->get_book_snapshot();
    Napi::Object out = Napi::Object::New(env);

    if (response.snapshot.best_bid.has_value()) {
      Napi::Object bid = Napi::Object::New(env);
      bid.Set("price", Napi::Number::New(env, static_cast<double>(response.snapshot.best_bid->price)));
      bid.Set("quantity",
              Napi::Number::New(env, static_cast<double>(response.snapshot.best_bid->remaining_quantity)));
      bid.Set("traderId", Napi::String::New(env, response.snapshot.best_bid->trader_id));
      out.Set("bestBid", bid);
    } else {
      out.Set("bestBid", env.Null());
    }

    if (response.snapshot.best_ask.has_value()) {
      Napi::Object ask = Napi::Object::New(env);
      ask.Set("price", Napi::Number::New(env, static_cast<double>(response.snapshot.best_ask->price)));
      ask.Set("quantity",
              Napi::Number::New(env, static_cast<double>(response.snapshot.best_ask->remaining_quantity)));
      ask.Set("traderId", Napi::String::New(env, response.snapshot.best_ask->trader_id));
      out.Set("bestAsk", ask);
    } else {
      out.Set("bestAsk", env.Null());
    }
    return out;
  }

  Napi::Value NetPosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string trader = info.Length() > 0 && info[0].IsString()
                             ? info[0].As<Napi::String>().Utf8Value()
                             : "";
    return Napi::Number::New(env, static_cast<double>(engine_->net_position(trader)));
  }
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return EngineWrapper::Init(env, exports);
}

NODE_API_MODULE(gasx_engine, InitAll)
