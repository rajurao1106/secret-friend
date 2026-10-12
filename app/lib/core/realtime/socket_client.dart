import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../network/api_base_url.dart';

final socketClientProvider = Provider<io.Socket>((ref) {
  final socket = io.io(
    apiBaseUrl,
    io.OptionBuilder()
        .setTransports(['websocket'])
        .disableAutoConnect()
        .build(),
  );

  ref.onDispose(socket.dispose);
  return socket;
});
