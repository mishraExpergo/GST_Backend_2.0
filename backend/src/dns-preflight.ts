import * as dns from 'node:dns';

// Windows/VPN setups often fail mongodb+srv SRV lookups with ECONNREFUSED on the
// system resolver. Public DNS fixes Atlas connectivity without changing the URI.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
} else {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}
