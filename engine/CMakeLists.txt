cmake_minimum_required(VERSION 3.16)
project(gasx_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

add_library(gasx_engine STATIC
  src/risk.cpp
  src/order_book.cpp
  src/matching_engine.cpp
  src/pre_trade_risk.cpp
  src/inventory_tracker.cpp
  src/pricing.cpp
  src/market_data_publisher.cpp
  src/protocol/engine_service.cpp
)
target_include_directories(gasx_engine PUBLIC include)

option(GASX_ENGINE_BUILD_TESTS "Build gasx_engine unit tests" ON)

if(GASX_ENGINE_BUILD_TESTS)
  include(FetchContent)
  FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.15.2
  )
  # Match Google's recommended settings so gtest doesn't fight the parent
  # project's runtime library selection (mainly relevant on MSVC).
  set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(googletest)

  enable_testing()
  add_executable(gasx_engine_tests
    tests/smoke_tests.cpp
    tests/risk_tests.cpp
    tests/order_book_tests.cpp
    tests/matching_engine_tests.cpp
    tests/pre_trade_risk_tests.cpp
    tests/inventory_tracker_tests.cpp
    tests/pricing_tests.cpp
    tests/market_data_publisher_tests.cpp
    tests/move_parity_tests.cpp
    tests/protocol_engine_service_tests.cpp
  )
  target_link_libraries(gasx_engine_tests PRIVATE gasx_engine GTest::gtest_main)

  include(GoogleTest)
  gtest_discover_tests(gasx_engine_tests)
endif()
