{
  "targets": [
    {
      "target_name": "gasx_engine",
      "sources": [
        "src/binding.cc",
        "../src/risk.cpp",
        "../src/order_book.cpp",
        "../src/matching_engine.cpp",
        "../src/pre_trade_risk.cpp",
        "../src/inventory_tracker.cpp",
        "../src/pricing.cpp",
        "../src/market_data_publisher.cpp",
        "../src/protocol/engine_service.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "../include"
      ],
      "cflags_cc": ["-std=c++17", "-fexceptions", "-O2"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_CPP_EXCEPTIONS"]
    }
  ]
}
