// swift-tools-version: 5.9

import PackageDescription

let package = Package(
	name: "ChameleonScreenCaptureKitHelper",
	platforms: [
		.macOS(.v13)
	],
	products: [
		.executable(
			name: "chameleon-screencapturekit-helper",
			targets: ["ChameleonScreenCaptureKitHelper"]
		),
		.executable(
			name: "chameleon-macos-cursor-helper",
			targets: ["ChameleonMacOSCursorHelper"]
		)
	],
	targets: [
		.executableTarget(
			name: "ChameleonScreenCaptureKitHelper",
			path: "Sources/ChameleonScreenCaptureKitHelper"
		),
		.executableTarget(
			name: "ChameleonMacOSCursorHelper",
			path: "Sources/ChameleonMacOSCursorHelper"
		)
	]
)
